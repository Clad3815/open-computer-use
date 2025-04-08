import os
import logging
import argparse
import shlex
import subprocess
from flask import Flask, request, jsonify, send_file
import threading
import traceback
import pyautogui
from PIL import Image
from io import BytesIO
import cv2
import numpy as np
import time
import base64
import tempfile
import uuid
from dataclasses import dataclass
from typing import Optional, Dict
from enum import Enum
import glob as glob_module
import re
import json
import queue

class JobStatus(Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    ERROR = "error"

@dataclass
class Job:
    id: str
    status: JobStatus
    output: Optional[str] = None
    error: Optional[str] = None
    returncode: Optional[int] = None
    video_path: Optional[str] = None
    video_base64: Optional[str] = None

@dataclass
class PowerShellJob:
    id: str
    command: str
    status: JobStatus
    output: str = ""
    error: str = ""
    returncode: Optional[int] = None
    process: Optional[subprocess.Popen] = None


# Global job storage
jobs: Dict[str, Job] = {}
powershell_jobs: Dict[str, PowerShellJob] = {}



parser = argparse.ArgumentParser()
parser.add_argument("--log_file", help="log file path", type=str,
                    default=os.path.join(os.path.dirname(__file__), "server.log"))
parser.add_argument("--port", help="port", type=int, default=5000)
args = parser.parse_args()

logging.basicConfig(filename=args.log_file,level=logging.DEBUG, filemode='w' )
logger = logging.getLogger('werkzeug')

app = Flask(__name__)

computer_control_lock = threading.Lock()


# Fonction pour étendre les variables d'environnement Windows
def expand_windows_env_vars(path):
    # Gérer les variables au format Windows standard (%USERPROFILE%)
    if '%' in path:
        for env_var, value in os.environ.items():
            var_pattern = f"%{env_var}%"
            if var_pattern in path:
                path = path.replace(var_pattern, value)
    
    # Gérer les variables au format PowerShell ($env:USERPROFILE)
    if '$env:' in path:
        for env_var, value in os.environ.items():
            var_pattern = f"$env:{env_var}"
            if var_pattern in path:
                path = path.replace(var_pattern, value)
    
    return path


@app.route('/probe', methods=['GET'])
def probe_endpoint():
    return jsonify({"status": "Probe successful", "message": "Service is operational"}), 200

def record_screen(stop_event, output_path):
    screen_width, screen_height = pyautogui.size()
    # Use H.264 codec with better parameters
    fourcc = cv2.VideoWriter_fourcc(*'avc1')
    out = cv2.VideoWriter(
        output_path,
        fourcc,
        20.0,
        (screen_width, screen_height),
        isColor=True
    )
    
    # Load cursor image once
    cursor_path = os.path.join(os.path.dirname(__file__), "cursor.png")
    cursor = Image.open(cursor_path)
    # make the cursor smaller
    cursor = cursor.resize((int(cursor.width / 1.5), int(cursor.height / 1.5)))
    
    while not stop_event.is_set():
        # Capture screenshot and cursor position
        screenshot = pyautogui.screenshot()
        cursor_x, cursor_y = pyautogui.position()
        
        # Add cursor to screenshot
        screenshot.paste(cursor, (cursor_x, cursor_y), cursor)
        
        # Convert to OpenCV format and write
        frame = np.array(screenshot)
        frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
        out.write(frame)
    
    out.release()

def delayed_recording_cleanup(job_id: str, stop_recording: threading.Event, recording_thread: threading.Thread, temp_video_path: str):
    time.sleep(3)  # Wait for 3 seconds after command completion
    stop_recording.set()
    recording_thread.join()
    
    try:
        # Read the video file and convert to base64
        with open(temp_video_path, "rb") as video_file:
            video_base64 = base64.b64encode(video_file.read()).decode('utf-8')
        
        # Update job with video data
        if job_id in jobs:
            jobs[job_id].video_base64 = video_base64
            jobs[job_id].status = JobStatus.COMPLETED
        
        # Clean up the temporary file
        os.remove(temp_video_path)
    except Exception as e:
        logger.error(f"Error in delayed cleanup for job {job_id}: {str(e)}\n{traceback.format_exc()}")
        if job_id in jobs:
            jobs[job_id].status = JobStatus.ERROR
            jobs[job_id].error = str(e)

@app.route('/execute', methods=['POST'])
def execute_command():
    # Only execute one command at a time
    with computer_control_lock:
        data = request.json
        shell = data.get('shell', False)
        command = data.get('command', "" if shell else [])

        if isinstance(command, str) and not shell:
            command = shlex.split(command)

        # Expand user directory
        for i, arg in enumerate(command):
            if arg.startswith("~/"):
                command[i] = os.path.expanduser(arg)

        # Create a new job
        job_id = str(uuid.uuid4())
        jobs[job_id] = Job(id=job_id, status=JobStatus.RUNNING)

        try:
            # Set up screen recording
            temp_video_path = os.path.join(tempfile.gettempdir(), f"screen_record_{job_id}.mp4")
            stop_recording = threading.Event()
            recording_thread = threading.Thread(target=record_screen, args=(stop_recording, temp_video_path))
            recording_thread.start()

            # Execute the command
            result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=shell, text=True, timeout=120)
            
            # Update job with command results
            jobs[job_id].output = result.stdout
            jobs[job_id].error = result.stderr
            jobs[job_id].returncode = result.returncode
            jobs[job_id].video_path = temp_video_path

            # Start cleanup thread
            cleanup_thread = threading.Thread(
                target=delayed_recording_cleanup,
                args=(job_id, stop_recording, recording_thread, temp_video_path)
            )
            cleanup_thread.start()

            return jsonify({
                'status': 'success',
                'output': result.stdout,
                'error': result.stderr,
                'returncode': result.returncode,
                'screen_recording_job_id': job_id
            })

        except Exception as e:
            logger.error("\n" + traceback.format_exc() + "\n")
            # Make sure to stop recording if there's an error
            if 'stop_recording' in locals():
                stop_recording.set()
                recording_thread.join()
            if 'temp_video_path' in locals() and os.path.exists(temp_video_path):
                os.remove(temp_video_path)
            
            # Update job with error
            jobs[job_id].status = JobStatus.ERROR
            jobs[job_id].error = str(e)
            
            return jsonify({
                'status': 'error',
                'message': str(e),
                'job_id': job_id
            })


def read_stream(stream, output_queue):
    """Lit le flux brut en continu et place les données dans une file d'attente."""
    while True:
        data = stream.read(1)  # Lire caractère par caractère
        if not data:  # Fin du flux
            break
        output_queue.put(data)
    stream.close()

def execute_powershell_in_thread(job_id, command):
    try:
        # Exécuter la commande PowerShell avec stdin, stdout et stderr configurés pour l'interactivité
        powershell_command = ['powershell', '-Command', command]
        process = subprocess.Popen(
            powershell_command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,  # Buffering minimal pour capturer en temps réel
            universal_newlines=True
        )
        
        # Stocker la référence au processus dans le job
        powershell_jobs[job_id].process = process
        
        # Mettre à jour le statut du job
        powershell_jobs[job_id].status = JobStatus.RUNNING
        
        # Files d'attente pour capturer la sortie et les erreurs
        stdout_queue = queue.Queue()
        stderr_queue = queue.Queue()
        
        # Démarrer des threads pour lire les flux en continu
        stdout_thread = threading.Thread(target=read_stream, args=(process.stdout, stdout_queue))
        stderr_thread = threading.Thread(target=read_stream, args=(process.stderr, stderr_queue))
        stdout_thread.daemon = True
        stderr_thread.daemon = True
        stdout_thread.start()
        stderr_thread.start()
        
        # Boucle principale pour récupérer les données en temps réel
        while True:
            # Vérifier si le processus est terminé
            if process.poll() is not None:
                break
            
            # Récupérer les données disponibles dans les files
            try:
                while not stdout_queue.empty():
                    char = stdout_queue.get_nowait()
                    powershell_jobs[job_id].output += char
            except queue.Empty:
                pass
            
            try:
                while not stderr_queue.empty():
                    char = stderr_queue.get_nowait()
                    powershell_jobs[job_id].error += char
            except queue.Empty:
                pass
            
            time.sleep(0.01)  # Petite pause pour éviter de surcharger le CPU
        
        # Attendre la fin des threads et capturer les données restantes
        stdout_thread.join()
        stderr_thread.join()
        
        while not stdout_queue.empty():
            powershell_jobs[job_id].output += stdout_queue.get()
        while not stderr_queue.empty():
            powershell_jobs[job_id].error += stderr_queue.get()
        
        # Mettre à jour le job avec le code de retour
        powershell_jobs[job_id].returncode = process.returncode
        powershell_jobs[job_id].status = JobStatus.COMPLETED
    except Exception as e:
        logger.error(f"Error in PowerShell job {job_id}: {str(e)}\n{traceback.format_exc()}")
        powershell_jobs[job_id].status = JobStatus.ERROR
        powershell_jobs[job_id].error = str(e)

@app.route('/powershell_job/<job_id>/input', methods=['POST'])
def send_powershell_input(job_id):
    if job_id not in powershell_jobs:
        return jsonify({
            'status': 'error',
            'message': 'PowerShell job not found'
        })
    
    job = powershell_jobs[job_id]
    
    # Vérifier si le job est toujours en cours d'exécution
    if job.status != JobStatus.RUNNING:
        return jsonify({
            'status': 'error',
            'message': 'PowerShell job is not running'
        })
    
    # Vérifier si le processus existe
    if job.process is None:
        return jsonify({
            'status': 'error',
            'message': 'PowerShell process not available'
        })
    
    try:
        data = request.json
        input_text = data.get('input', '')
        
        # Ajouter un saut de ligne si non présent
        if not input_text.endswith('\n'):
            input_text += '\n'
        
        # Envoyer l'entrée au processus
        job.process.stdin.write(input_text)
        job.process.stdin.flush()
        
        return jsonify({
            'status': 'success',
            'message': 'Input sent to PowerShell job'
        })
    except Exception as e:
        logger.error(f"Error sending input to PowerShell job {job_id}: {str(e)}\n{traceback.format_exc()}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        })

@app.route('/powershell_job/<job_id>/kill', methods=['POST'])
def kill_powershell_process(job_id):
    """
    Kills a running PowerShell process by its job ID.
    """
    if job_id not in powershell_jobs:
        return jsonify({
            'status': 'error',
            'message': 'PowerShell job not found'
        })
    
    job = powershell_jobs[job_id]
    
    # Check if the job is still running
    if job.status != JobStatus.RUNNING:
        return jsonify({
            'status': 'error',
            'message': f'PowerShell job is not running (current status: {job.status.value})'
        })
    
    # Check if the process reference exists
    if job.process is None:
        return jsonify({
            'status': 'error',
            'message': 'PowerShell process reference not available'
        })
    
    try:
        # Attempt to terminate the process
        job.process.terminate()
        
        # Give it a short time to terminate gracefully
        try:
            job.process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            # If it doesn't terminate within the timeout, force kill it
            job.process.kill()
            job.process.wait()
        
        # Update job status
        job.status = JobStatus.ERROR
        job.error += "\nProcess was terminated by user request."
        job.returncode = job.process.returncode
        
        return jsonify({
            'status': 'success',
            'message': 'PowerShell process terminated successfully',
            'job_id': job_id
        })
    except Exception as e:
        logger.error(f"Error terminating PowerShell job {job_id}: {str(e)}\n{traceback.format_exc()}")
        return jsonify({
            'status': 'error',
            'message': f'Failed to terminate process: {str(e)}'
        })

@app.route('/execute_powershell', methods=['POST'])
def execute_powershell_command():
    data = request.json
    command = data.get('command', '')

    # Créer un nouvel ID de job
    job_id = str(uuid.uuid4())
    powershell_jobs[job_id] = PowerShellJob(id=job_id, command=command, status=JobStatus.RUNNING)

    # Démarrer l'exécution dans un thread séparé
    threading.Thread(target=execute_powershell_in_thread, args=(job_id, command)).start()

    return jsonify({
        'status': 'success',
        'message': 'PowerShell command execution started',
        'job_id': job_id
    })

# Ajouter le nouvel endpoint pour vérifier le statut d'un job PowerShell:
@app.route('/powershell_job/<job_id>', methods=['GET'])
def get_powershell_job_status(job_id):
    if job_id not in powershell_jobs:
        return jsonify({
            'status': 'error',
            'message': 'PowerShell job not found'
        })

    job = powershell_jobs[job_id]
    response = {
        'status': job.status.value,
        'job_id': job.id,
        'command': job.command
    }

    # Toujours renvoyer l'output et l'error, même si le job est en cours
    response.update({
        'output': job.output,
        'error': job.error
    })

    # Ajouter le code de retour si le job est terminé
    if job.status == JobStatus.COMPLETED or job.status == JobStatus.ERROR:
        response.update({
            'returncode': job.returncode
        })

    return jsonify(response)


# Route pour lire un fichier
@app.route('/file/read', methods=['POST'])
def file_read():
    data = request.json
    file_path = data.get('file', '')
    start_line = data.get('start_line')
    end_line = data.get('end_line')
    sudo = data.get('sudo', False)
    
    try:
        if not os.path.exists(file_path):
            return jsonify({
                'status': 'error',
                'message': f'File not found: {file_path}'
            })
            
        # Créer un nouvel ID de job pour l'enregistrement d'écran
        job_id = str(uuid.uuid4())
        jobs[job_id] = Job(id=job_id, status=JobStatus.RUNNING)
            
        # Configuration de l'enregistrement d'écran
        temp_video_path = os.path.join(tempfile.gettempdir(), f"screen_record_{job_id}.mp4")
        stop_recording = threading.Event()
        recording_thread = threading.Thread(target=record_screen, args=(stop_recording, temp_video_path))
        recording_thread.start()
        
        # Lecture du fichier
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            if start_line is not None and end_line is not None:
                # Lire seulement les lignes spécifiées
                lines = f.readlines()
                content = ''.join(lines[start_line:end_line])
            elif start_line is not None:
                lines = f.readlines()
                content = ''.join(lines[start_line:])
            else:
                content = f.read()
        
        # Mise à jour du job avec les résultats
        jobs[job_id].output = content
        jobs[job_id].returncode = 0
        jobs[job_id].video_path = temp_video_path
        
        # Démarrer le thread de nettoyage
        cleanup_thread = threading.Thread(
            target=delayed_recording_cleanup,
            args=(job_id, stop_recording, recording_thread, temp_video_path)
        )
        cleanup_thread.start()
        
        return jsonify({
            'status': 'success',
            'output': content,
            'returncode': 0,
            'screen_recording_job_id': job_id
        })
    except Exception as e:
        logger.error("\n" + traceback.format_exc() + "\n")
        # Arrêter l'enregistrement en cas d'erreur
        if 'stop_recording' in locals():
            stop_recording.set()
            recording_thread.join()
        if 'temp_video_path' in locals() and os.path.exists(temp_video_path):
            os.remove(temp_video_path)
        
        # Mise à jour du job avec l'erreur
        if 'job_id' in locals():
            jobs[job_id].status = JobStatus.ERROR
            jobs[job_id].error = str(e)
        
        return jsonify({
            'status': 'error',
            'message': str(e)
        })

# Route pour écrire dans un fichier
@app.route('/file/write', methods=['POST'])
def file_write():
    data = request.json
    file_path = data.get('file', '')
    content = data.get('content', '')
    append = data.get('append', False)
    leading_newline = data.get('leading_newline', False)
    trailing_newline = data.get('trailing_newline', False)
    sudo = data.get('sudo', False)
    
    try:
        # Étendre les variables d'environnement Windows dans le chemin du fichier
        file_path = expand_windows_env_vars(file_path)
        # Préparation du contenu
        if leading_newline:
            content = '\n' + content
        if trailing_newline:
            content = content + '\n'
            
        # Créer un nouvel ID de job pour l'enregistrement d'écran
        job_id = str(uuid.uuid4())
        jobs[job_id] = Job(id=job_id, status=JobStatus.RUNNING)
            
        # Configuration de l'enregistrement d'écran
        temp_video_path = os.path.join(tempfile.gettempdir(), f"screen_record_{job_id}.mp4")
        stop_recording = threading.Event()
        recording_thread = threading.Thread(target=record_screen, args=(stop_recording, temp_video_path))
        recording_thread.start()
        
        # Écriture du fichier
        mode = 'a' if append else 'w'
        with open(file_path, mode, encoding='utf-8') as f:
            f.write(content)
        
        # Mise à jour du job avec les résultats
        jobs[job_id].output = f"Content {'appended to' if append else 'written to'} {file_path}"
        jobs[job_id].returncode = 0
        jobs[job_id].video_path = temp_video_path
        
        # Démarrer le thread de nettoyage
        cleanup_thread = threading.Thread(
            target=delayed_recording_cleanup,
            args=(job_id, stop_recording, recording_thread, temp_video_path)
        )
        cleanup_thread.start()
        
        return jsonify({
            'status': 'success',
            'output': f"Content {'appended to' if append else 'written to'} {file_path}",
            'returncode': 0,
            'screen_recording_job_id': job_id
        })
    except Exception as e:
        logger.error("\n" + traceback.format_exc() + "\n")
        # Arrêter l'enregistrement en cas d'erreur
        if 'stop_recording' in locals():
            stop_recording.set()
            recording_thread.join()
        if 'temp_video_path' in locals() and os.path.exists(temp_video_path):
            os.remove(temp_video_path)
        
        # Mise à jour du job avec l'erreur
        if 'job_id' in locals():
            jobs[job_id].status = JobStatus.ERROR
            jobs[job_id].error = str(e)
        
        return jsonify({
            'status': 'error',
            'message': str(e)
        })

# Route pour remplacer une chaîne dans un fichier
@app.route('/file/str_replace', methods=['POST'])
def file_str_replace():
    data = request.json
    file_path = data.get('file', '')
    old_str = data.get('old_str', '')
    new_str = data.get('new_str', '')
    sudo = data.get('sudo', False)
    
    try:
        if not os.path.exists(file_path):
            return jsonify({
                'status': 'error',
                'message': f'File not found: {file_path}'
            })
            
        # Créer un nouvel ID de job pour l'enregistrement d'écran
        job_id = str(uuid.uuid4())
        jobs[job_id] = Job(id=job_id, status=JobStatus.RUNNING)
            
        # Configuration de l'enregistrement d'écran
        temp_video_path = os.path.join(tempfile.gettempdir(), f"screen_record_{job_id}.mp4")
        stop_recording = threading.Event()
        recording_thread = threading.Thread(target=record_screen, args=(stop_recording, temp_video_path))
        recording_thread.start()
        # Étendre les variables d'environnement Windows dans le chemin du fichier
        file_path = expand_windows_env_vars(file_path)
        
        # Lecture du contenu actuel
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        
        # Comptage des occurrences avant le remplacement
        occurrences = content.count(old_str)
        
        # Remplacement
        new_content = content.replace(old_str, new_str)
        
        # Écriture du nouveau contenu
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        
        result_message = f"Replaced {occurrences} occurrence(s) of '{old_str}' with '{new_str}' in {file_path}"
        
        # Mise à jour du job avec les résultats
        jobs[job_id].output = result_message
        jobs[job_id].returncode = 0
        jobs[job_id].video_path = temp_video_path
        
        # Démarrer le thread de nettoyage
        cleanup_thread = threading.Thread(
            target=delayed_recording_cleanup,
            args=(job_id, stop_recording, recording_thread, temp_video_path)
        )
        cleanup_thread.start()
        
        return jsonify({
            'status': 'success',
            'output': result_message,
            'returncode': 0,
            'occurrences': occurrences,
            'screen_recording_job_id': job_id
        })
    except Exception as e:
        logger.error("\n" + traceback.format_exc() + "\n")
        # Arrêter l'enregistrement en cas d'erreur
        if 'stop_recording' in locals():
            stop_recording.set()
            recording_thread.join()
        if 'temp_video_path' in locals() and os.path.exists(temp_video_path):
            os.remove(temp_video_path)
        
        # Mise à jour du job avec l'erreur
        if 'job_id' in locals():
            jobs[job_id].status = JobStatus.ERROR
            jobs[job_id].error = str(e)
        
        return jsonify({
            'status': 'error',
            'message': str(e)
        })

# Route pour rechercher du contenu dans un fichier
@app.route('/file/find_in_content', methods=['POST'])
def file_find_in_content():
    data = request.json
    file_path = data.get('file', '')
    regex = data.get('regex', '')
    sudo = data.get('sudo', False)
    
    try:
        if not os.path.exists(file_path):
            return jsonify({
                'status': 'error',
                'message': f'File not found: {file_path}'
            })
            
        # Créer un nouvel ID de job pour l'enregistrement d'écran
        job_id = str(uuid.uuid4())
        jobs[job_id] = Job(id=job_id, status=JobStatus.RUNNING)
            
        # Configuration de l'enregistrement d'écran
        temp_video_path = os.path.join(tempfile.gettempdir(), f"screen_record_{job_id}.mp4")
        stop_recording = threading.Event()
        recording_thread = threading.Thread(target=record_screen, args=(stop_recording, temp_video_path))
        recording_thread.start()
        # Étendre les variables d'environnement Windows dans le chemin du fichier
        file_path = expand_windows_env_vars(file_path)
        
        # Lecture du fichier
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
            
        # Recherche avec l'expression régulière
        pattern = re.compile(regex)
        matches = []
        line_num = 0
        
        for line in content.splitlines():
            line_num += 1
            for match in pattern.finditer(line):
                matches.append({
                    'line': line_num,
                    'column': match.start() + 1,
                    'text': match.group(),
                    'full_line': line
                })
        
        # Mise à jour du job avec les résultats
        match_output = json.dumps(matches, indent=2)
        jobs[job_id].output = match_output
        jobs[job_id].returncode = 0
        jobs[job_id].video_path = temp_video_path
        
        # Démarrer le thread de nettoyage
        cleanup_thread = threading.Thread(
            target=delayed_recording_cleanup,
            args=(job_id, stop_recording, recording_thread, temp_video_path)
        )
        cleanup_thread.start()
        
        return jsonify({
            'status': 'success',
            'output': match_output,
            'matches': matches,
            'returncode': 0,
            'screen_recording_job_id': job_id
        })
    except Exception as e:
        logger.error("\n" + traceback.format_exc() + "\n")
        # Arrêter l'enregistrement en cas d'erreur
        if 'stop_recording' in locals():
            stop_recording.set()
            recording_thread.join()
        if 'temp_video_path' in locals() and os.path.exists(temp_video_path):
            os.remove(temp_video_path)
        
        # Mise à jour du job avec l'erreur
        if 'job_id' in locals():
            jobs[job_id].status = JobStatus.ERROR
            jobs[job_id].error = str(e)
        
        return jsonify({
            'status': 'error',
            'message': str(e)
        })

# Route pour rechercher des fichiers par nom/motif
@app.route('/file/find_by_name', methods=['POST'])
def file_find_by_name():
    data = request.json
    path = data.get('path', '')
    glob_pattern = data.get('glob', '*')
    
    try:
        if not os.path.exists(path):
            return jsonify({
                'status': 'error',
                'message': f'Directory not found: {path}'
            })
            
        # Créer un nouvel ID de job pour l'enregistrement d'écran
        job_id = str(uuid.uuid4())
        jobs[job_id] = Job(id=job_id, status=JobStatus.RUNNING)
            
        # Configuration de l'enregistrement d'écran
        temp_video_path = os.path.join(tempfile.gettempdir(), f"screen_record_{job_id}.mp4")
        stop_recording = threading.Event()
        recording_thread = threading.Thread(target=record_screen, args=(stop_recording, temp_video_path))
        recording_thread.start()
        
        
        
        # Étendre les variables d'environnement Windows dans le chemin du fichier
        path = expand_windows_env_vars(path)
        # Recherche des fichiers avec le motif glob
        search_path = os.path.join(path, glob_pattern)
        files = glob_module.glob(search_path, recursive=True)
        
        # Formatage des résultats
        file_list = []
        for file_path in files:
            file_info = {
                'path': file_path,
                'name': os.path.basename(file_path),
                'size': os.path.getsize(file_path),
                'is_directory': os.path.isdir(file_path),
                'created': os.path.getctime(file_path),
                'modified': os.path.getmtime(file_path)
            }
            file_list.append(file_info)
        
        # Mise à jour du job avec les résultats
        result_output = json.dumps(file_list, indent=2)
        jobs[job_id].output = result_output
        jobs[job_id].returncode = 0
        jobs[job_id].video_path = temp_video_path
        
        # Démarrer le thread de nettoyage
        cleanup_thread = threading.Thread(
            target=delayed_recording_cleanup,
            args=(job_id, stop_recording, recording_thread, temp_video_path)
        )
        cleanup_thread.start()
        
        return jsonify({
            'status': 'success',
            'output': result_output,
            'files': file_list,
            'count': len(file_list),
            'returncode': 0,
            'screen_recording_job_id': job_id
        })
    except Exception as e:
        logger.error("\n" + traceback.format_exc() + "\n")
        # Arrêter l'enregistrement en cas d'erreur
        if 'stop_recording' in locals():
            stop_recording.set()
            recording_thread.join()
        if 'temp_video_path' in locals() and os.path.exists(temp_video_path):
            os.remove(temp_video_path)
        
        # Mise à jour du job avec l'erreur
        if 'job_id' in locals():
            jobs[job_id].status = JobStatus.ERROR
            jobs[job_id].error = str(e)
        
        return jsonify({
            'status': 'error',
            'message': str(e)
        })

@app.route('/job/<job_id>', methods=['GET'])
def get_job_status(job_id):
    if job_id not in jobs:
        return jsonify({
            'status': 'error',
            'message': 'Job not found'
        })

    job = jobs[job_id]
    response = {
        'status': job.status.value,
        'job_id': job.id
    }

    if job.status == JobStatus.COMPLETED:
        response.update({
            'output': job.output,
            'error': job.error,
            'returncode': job.returncode,
            'screen_recording': job.video_base64
        })
    elif job.status == JobStatus.ERROR:
        response.update({
            'error': job.error
        })

    return jsonify(response)

@app.route('/screenshot', methods=['GET'])
def capture_screen_with_cursor():    
    cursor_path = os.path.join(os.path.dirname(__file__), "cursor.png")
    screenshot = pyautogui.screenshot()
    cursor_x, cursor_y = pyautogui.position()
    cursor = Image.open(cursor_path)
    # make the cursor smaller
    cursor = cursor.resize((int(cursor.width / 1.5), int(cursor.height / 1.5)))
    screenshot.paste(cursor, (cursor_x, cursor_y), cursor)
    

    # Convert PIL Image to bytes and send
    img_io = BytesIO()
    screenshot.save(img_io, 'PNG')
    img_io.seek(0)
    return send_file(img_io, mimetype='image/png')

if __name__ == '__main__':
    app.run(debug=True, host="0.0.0.0", port=args.port)