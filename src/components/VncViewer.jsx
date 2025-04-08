import React, { useState, useEffect, forwardRef, useImperativeHandle, useRef } from 'react';
import { X, Play, Eye, Info, ArrowLeft, Save, Loader } from 'lucide-react';

const ActionDetailsModal = ({ action, onClose }) => {
  if (!action) return null;
  const modalRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        onClose();
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const formatData = (data) => {
    if (typeof data === 'object' && data !== null) {
      return Object.entries(data).map(([key, value]) => {
        // Skip screenshot and video data
        if (key.includes('screenshot') || key.includes('recording')) return null;
        
        return (
          <div key={key} className="mb-3 flex flex-col gap-1.5">
            <span className="text-white/60 text-xs font-medium">{key}:</span>
            <span className="text-white text-sm leading-6 break-words">
              {typeof value === 'object' ? (
                <div className="ml-4 pl-3 border-l border-white/10">
                  {formatData(value)}
                </div>
              ) : (
                String(value)
              )}
            </span>
          </div>
        );
      }).filter(Boolean);
    }
    return String(data);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-[950] modal-overlay animate-fadeIn">
      <div 
        ref={modalRef}
        className="modal-content bg-[#1E1E1E] rounded-lg w-full max-w-[800px] max-h-[90vh] mx-5 shadow-lg flex flex-col overflow-hidden animate-scale"
      >
        <div className="flex justify-between items-center p-5 border-b border-[#333]">
          <div className="flex items-center gap-2">
            <Info size={18} className="text-white/70" />
            <span className="text-white text-base font-medium">Action Details</span>
          </div>
          <button 
            className="btn btn-ghost btn-icon p-1.5 hover:bg-white/10 rounded-full"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-hidden">
          <div className="overflow-y-auto max-h-[calc(90vh-120px)] scrollbar-thin pr-2">
            <div className="mb-5 pb-4 border-b border-white/10">
              <div className="mb-3 flex flex-col gap-1.5">
                <span className="text-white/60 text-xs font-medium">Text:</span>
                <span className="text-white text-sm leading-6 break-words">{action.text}</span>
              </div>
              <div className="mb-3 flex flex-col gap-1.5">
                <span className="text-white/60 text-xs font-medium">Action Type:</span>
                <span className="text-white text-sm leading-6 break-words">{action.action_type}</span>
              </div>
            </div>
            
            <div className="mb-5 pb-4 border-b border-white/10">
              <div className="mb-3 flex flex-col gap-1.5">
                <span className="text-white/60 text-xs font-medium">Start:</span>
                <span className="text-white text-sm leading-6 break-words">{new Date(action.start_time).toLocaleString()}</span>
              </div>
              {action.end_time && (
                <div className="mb-3 flex flex-col gap-1.5">
                  <span className="text-white/60 text-xs font-medium">End:</span>
                  <span className="text-white text-sm leading-6 break-words">{new Date(action.end_time).toLocaleString()}</span>
                </div>
              )}
              <div className="mb-3 flex flex-col gap-1.5">
                <span className="text-white/60 text-xs font-medium">Box ID:</span>
                <span className="text-white text-sm leading-6 break-words">{action.box_id}</span>
              </div>
            </div>

            {action.metadata?.actionData && (
              <div>
                <h3 className="text-white text-sm font-medium mb-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/50"></span>
                  Action Data
                </h3>
                <div className="ml-4 pl-3 border-l border-white/10">
                  {formatData(action.metadata.actionData)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const EndControlPopup = ({ onClose, onReturnToChat, onReturnToOperator }) => {
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const modalRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        onClose();
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const handleSubmit = () => {
    setIsSubmitting(true);
    
    // Simulate a slight delay to make the transition feel smoother
    setTimeout(() => {
      onReturnToOperator(message);
      setIsSubmitting(false);
    }, 300);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-[950] modal-overlay animate-fadeIn">
      <div 
        ref={modalRef}
        className="modal-content bg-[#1E1E1E] rounded-lg w-full max-w-[500px] mx-5 shadow-lg flex flex-col overflow-hidden animate-scale"
      >
        <div className="p-5 pb-5 border-b border-[#333] flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Save size={18} className="text-white/70" />
            <span className="text-white text-base font-medium">Let Operator know what you changed</span>
          </div>
          <button 
            className="btn btn-ghost btn-icon p-1.5 hover:bg-white/10 rounded-full"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          <p className="text-white/60 text-sm mb-4">Share a summary to help Operator.</p>
          <textarea
            className="input w-full min-h-[120px] bg-[#2D2D2D] border border-[#333] rounded-md p-3 text-white text-sm resize-y focus:outline-none focus:border-[#666] placeholder:text-white/40"
            placeholder="What did you do while you had control? (Optional)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <div className="p-4 border-t border-[#333] flex justify-end gap-3">
          <button 
            className="btn btn-secondary py-2 px-4"
            onClick={onReturnToChat}
          >
            Return to Chat
          </button>
          <button 
            className="btn btn-primary py-2 px-4 flex items-center gap-1.5"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader size={16} className="animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <>Return to Operator</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

const VideoViewer = ({ video, screenshot, onClose }) => {
  const [isLoading, setIsLoading] = useState(true);
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      const handleLoadedData = () => {
        setIsLoading(false);
      };
      
      videoRef.current.addEventListener('loadeddata', handleLoadedData);
      
      return () => {
        if (videoRef.current) {
          videoRef.current.removeEventListener('loadeddata', handleLoadedData);
        }
      };
    }
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col justify-center items-center bg-[#111] overflow-hidden">
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black/80">
          {screenshot && (
            <div className="relative mb-6 max-w-full max-h-[70vh] overflow-hidden rounded-lg opacity-30">
              <img 
                src={screenshot} 
                alt="Preview" 
                className="max-w-full max-h-[70vh] object-contain"
              />
            </div>
          )}
          <div className="flex flex-col items-center">
            <Loader size={32} className="animate-spin mb-4 text-white/70" />
            <span className="text-white/70 text-sm">Loading video...</span>
          </div>
        </div>
      )}
      <video 
        ref={videoRef}
        className="max-w-full max-h-full object-contain bg-black rounded-lg shadow-md z-0"
        controls
        autoPlay
        src={video}
      />
      
      <div className="absolute bottom-0 left-0 right-0 p-4 flex justify-between items-center bg-gradient-to-t from-black/80 to-transparent">
        <button 
          className="btn btn-secondary py-2 px-4 flex items-center gap-1.5"
          onClick={onClose}
        >
          <ArrowLeft size={16} />
          <span>Back to VNC</span>
        </button>
        
        <div className="text-white/60 text-xs">
          Action Video
        </div>
      </div>
    </div>
  );
};

const VncViewer = forwardRef(({ onControlChange, onSendMessage }, ref) => {
  const [isControlEnabled, setIsControlEnabled] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [showEndPopup, setShowEndPopup] = useState(false);
  const [currentAction, setCurrentAction] = useState(null);
  const [showVideo, setShowVideo] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [hoveredControls, setHoveredControls] = useState(false);
  const windowsHostUrl = import.meta.env.VITE_WINDOWS_HOST_URL || 'localhost:8006';
  
  const vncUrl = `http://${windowsHostUrl}/vnc.html?autoconnect=1&resize=scale&view_only=${isControlEnabled ? '0' : '1'}`;

  useImperativeHandle(ref, () => ({
    handleShowAction: (action) => {
      setCurrentAction(action);
      setShowVideo(false);
    },
    handleShowVideo: (action) => {
      if (action) {
        setCurrentAction(action);
      }
    }
  }));

  useEffect(() => {
    onControlChange?.(isControlEnabled);
  }, [isControlEnabled, onControlChange]);

  const toggleControl = () => {
    setIsControlEnabled(!isControlEnabled);
    setIsHovering(false);
  };

  const handleEndControl = () => {
    setShowEndPopup(true);
  };

  const handleClosePopup = () => {
    setShowEndPopup(false);
  };

  const handleReturnToChat = () => {
    setIsControlEnabled(false);
    setShowEndPopup(false);
  };

  const handleReturnToOperator = (message) => {
    if (message.trim()) {
      onSendMessage?.(message);
    }
    setIsControlEnabled(false);
    setShowEndPopup(false);
  };

  const handlePlayVideo = () => {
    setShowVideo(true);
  };

  const handleClose = () => {
    setCurrentAction(null);
    setShowVideo(false);
  };

  return (
    <div className={`flex flex-col h-full ${isControlEnabled ? 'fixed inset-0 z-[900] p-0' : 'p-4 bg-[#1A1A1A]'}`}>
      <div 
        className={`${isControlEnabled ? 'h-[calc(100vh-4rem)]' : 'flex-1'} relative bg-[#1A1A1A] rounded-md overflow-hidden ${isControlEnabled ? 'border-0 rounded-none' : 'border border-[#333]'}`}
        onMouseEnter={() => !isControlEnabled && setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {!isControlEnabled && isHovering && !currentAction && !showVideo && (
          <div className="absolute inset-0 bg-black/80 flex justify-center items-center z-[900] animate-fadeIn backdrop-blur-sm">
            <button 
              className="btn btn-primary py-4 px-8 text-base flex items-center gap-2 animate-scale group" 
              onClick={toggleControl}
            >
              <div className="text-white/80 group-hover:scale-110 transition-transform">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 11l4.553-2.276A1 1 0 0121 9.618v6.764a1 1 0 01-1.447.894L15 15v-4z"></path>
                  <rect x="3" y="5" width="12" height="14" rx="2"></rect>
                </svg>
              </div>
              <span>Take Control</span>
            </button>
          </div>
        )}
        {showVideo && currentAction?.metadata?.screen_recording_base64 ? (
          <VideoViewer
            video={currentAction.metadata.screen_recording_base64}
            screenshot={currentAction.metadata.screenshot_base64}
            onClose={handleClose}
          />
        ) : currentAction?.metadata?.screenshot_base64 ? (
          <div className="relative w-full h-full flex justify-center items-center bg-[#111]">
            <img 
              src={currentAction.metadata.screenshot_base64} 
              alt="Action Screenshot" 
              className="max-w-full max-h-full object-contain"
            />
            {currentAction.metadata.screen_recording_base64 && (
              <button 
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 border border-white/10 rounded-full w-24 h-24 cursor-pointer text-white flex items-center justify-center transition-all hover:scale-110 hover:shadow-lg p-0 animate-fadeIn backdrop-blur-sm"
                onClick={handlePlayVideo}
              >
                <Play 
                  size={48} 
                  fill="white" 
                  className="ml-2 filter drop-shadow-lg"
                />
              </button>
            )}
            <div className="absolute bottom-0 left-0 right-0 p-4 flex justify-between items-center bg-gradient-to-t from-black/80 to-transparent">
              <button 
                className="btn btn-secondary py-2 px-4 flex items-center gap-1.5"
                onClick={handleClose}
              >
                <ArrowLeft size={16} />
                <span>Back to VNC</span>
              </button>
              
              <button 
                className="btn btn-primary py-2 px-4 flex items-center gap-1.5"
                onClick={() => setShowDetails(true)}
              >
                <Info size={16} />
                <span>View Details</span>
              </button>
            </div>
          </div>
        ) : (
          <iframe
            className="border-none w-full h-full block bg-[#1A1A1A] rounded-none"
            src={vncUrl}
            title="VNC Viewer"
            allow="fullscreen"
            allowFullScreen
          />
        )}
      </div>
      {isControlEnabled && (
        <div 
          className="control-bar h-16 flex justify-center items-center gap-6 px-8 relative"
          onMouseEnter={() => setHoveredControls(true)}
          onMouseLeave={() => setHoveredControls(false)}
        >
          <div 
            className="absolute inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent -top-[1px]"
            style={{
              opacity: hoveredControls ? 0.6 : 0.3,
              transition: 'opacity 0.3s ease'
            }}
          ></div>
          <div className="text-white/80 text-sm flex items-center gap-2">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div> 
              <span>You have control</span>
            </div>
          </div>
          <button 
            className="btn btn-primary py-2.5 px-6"
            onClick={handleEndControl}
          >
            End Control
          </button>
        </div>
      )}
      {showEndPopup && (
        <EndControlPopup
          onClose={handleClosePopup}
          onReturnToChat={handleReturnToChat}
          onReturnToOperator={handleReturnToOperator}
        />
      )}
      {showDetails && (
        <ActionDetailsModal
          action={currentAction}
          onClose={() => setShowDetails(false)}
        />
      )}
    </div>
  );
});

export default VncViewer; 