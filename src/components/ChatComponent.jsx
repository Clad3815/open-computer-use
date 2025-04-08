import React, { useState, useEffect, forwardRef, useImperativeHandle, useRef } from 'react';
import { ArrowUp, Clock, ChevronDown, ChevronRight, Loader2, Eye, Brain, CheckCircle2, Circle, AlertCircle, Settings, Play, CheckCheck, Monitor } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSettings } from '../App';


const MarkdownMessage = ({ content, compact = false }) => {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
                p: ({ children }) => (
                    <p className={compact ? "my-0 leading-tight" : "my-2 leading-6"}>
                        {children}
                    </p>
                ),
                h1: ({ children }) => <h1 className="text-2xl font-semibold mt-4 mb-2 text-white">{children}</h1>,
                h2: ({ children }) => <h2 className="text-xl font-semibold mt-3 mb-1.5 text-white">{children}</h2>,
                h3: ({ children }) => <h3 className="text-lg font-semibold mt-2 mb-1 text-white">{children}</h3>,
                ul: ({ children }) => <ul className="my-2 pl-6">{children}</ul>,
                ol: ({ children }) => <ol className="my-2 pl-6">{children}</ol>,
                li: ({ children }) => <li className="my-1">{children}</li>,
                code: ({ node, inline, className, children, ...props }) => (
                    <code
                        className={`${inline ? 'bg-black/20 px-1.5 py-0.5 rounded font-mono text-sm' : 'block bg-black/20 p-4 rounded-md font-mono text-sm overflow-x-auto my-2'} ${className || ''}`}
                        {...props}
                    >
                        {children}
                    </code>
                ),
                pre: ({ children }) => <pre className="my-2 bg-transparent">{children}</pre>,
                blockquote: ({ children }) => <blockquote className="border-l-3 border-white/20 my-2 pl-4 text-white/70 italic">{children}</blockquote>,
                a: ({ children, href }) => (
                    <a className="text-[#3291ff] no-underline hover:text-[#5ca9ff] hover:underline transition-colors" href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                    </a>
                ),
            }}
        >
            {content}
        </ReactMarkdown>
    );
};

// Update the ActionsList component
// Modify the isNotification function and add helper functions for new tools

const ActionsList = ({ actions, onShowScreenshot, onShowVideo }) => {
    if (!actions) return null;
    const [elapsedTime, setElapsedTime] = useState(0);
    const [isExpanded, setIsExpanded] = useState(true);
    const isOngoing = !actions.end_time;
    const actionsListRef = useRef(null);
    const totalActions = actions.list_of_actions.length;
    const completedActions = actions.list_of_actions.filter(action => action.end_time).length;
    const isThinking = !actions.end_time && completedActions === totalActions;
    
    // Find the current active action
    const currentAction = isOngoing && !isThinking ? 
        actions.list_of_actions.find(action => !action.end_time) : null;
    
    // Calculate progress percentage
    const progressPercentage = totalActions > 0 ? (completedActions / totalActions) * 100 : 0;

    // Helper functions for new tool types
    const getActionIcon = (action) => {
        // Base action icon selection on action_type
        const actionType = action.action_type;
        
        // Mouse actions
        if (['left_click', 'right_click', 'double_click', 'middle_click'].includes(actionType)) {
            return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 9V1.5M9 9L3 14.5M9 9L15 14.5" />
            </svg>;
        }
        
        // Keyboard actions
        if (['type', 'type_no_enter', 'key'].includes(actionType)) {
            return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
            </svg>;
        }
        
        // Scroll actions
        if (['scroll_up', 'scroll_down', 'scroll_up_until_text_found', 'scroll_down_until_text_found'].includes(actionType)) {
            return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>;
        }
        
        // Hover action
        if (actionType === 'hover') {
            return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
            </svg>;
        }
        
        // Drag action
        if (actionType === 'left_click_drag') {
            return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 7l-5 5 5 5" />
                <path d="M10 12h10" />
            </svg>;
        }
        
        // PowerShell action
        if (actionType === 'exec_powershell_cmd') {
            return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 7l5 5-5 5M12 17h7" />
            </svg>;
        }
        
        // Wait action
        if (actionType === 'wait') {
            return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
            </svg>;
        }
        
        // Default icon
        return <Circle size={10} className="text-white/30" />;
    };
    
    // Check if action is a notification or user interaction
    const isNotification = (action) => {
        return action.action_type === "message_notify_user" && 
               action.metadata?.notification;
    };
    
    const isUserQuestion = (action) => {
        return action.action_type === "message_ask_user" &&
               action.metadata?.question;
    };
    
    // Get action CSS class based on type
    const getActionClassName = (action) => {
        const baseClass = "action-item flex items-center px-3 py-1 transition-all mx-1 rounded-md";
        const hasScreenshot = !!action.metadata?.screenshot_base64;
        const done = action.end_time && action.end_time <= Date.now();
        const isActive = !done && !action.end_time;
        
        let typeClass = '';
        
        // Mouse actions
        if (['left_click', 'right_click', 'double_click', 'middle_click'].includes(action.action_type)) {
            typeClass = 'mouse-action';
        }
        
        // Keyboard actions
        else if (['type', 'type_no_enter', 'key'].includes(action.action_type)) {
            typeClass = 'keyboard-action';
        }
        
        // Scroll actions
        else if (['scroll_up', 'scroll_down', 'scroll_up_until_text_found', 'scroll_down_until_text_found'].includes(action.action_type)) {
            typeClass = 'scroll-action';
        }
        
        return `${baseClass} ${typeClass} ${
            hasScreenshot ? 'has-screenshot cursor-pointer' : ''
        } ${
            isActive 
                ? 'bg-[#3291ff]/10 text-white action-active' 
                : done 
                    ? 'text-white/80 hover:bg-white/5 action-done' 
                    : 'text-white/70 hover:bg-white/5'
        }`;
    };

    useEffect(() => {
        if (actionsListRef.current && isExpanded) {
            actionsListRef.current.scrollTop = actionsListRef.current.scrollHeight;
        }
    }, [actions.list_of_actions.length, isExpanded]);

    // Auto-expand when actions are updated
    useEffect(() => {
        if (actions.list_of_actions.length > 0 && isOngoing) {
            setIsExpanded(true);
        }
    }, [actions.list_of_actions.length, isOngoing]);

    useEffect(() => {
        let intervalId;
        if (isOngoing && actions.start_time) {
            intervalId = setInterval(() => {
                const now = Date.now();
                setElapsedTime((now - actions.start_time) / 1000);
            }, 100);
        }
        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [actions, isOngoing]);

    const formatDuration = (startTime, endTime) => {
        const duration = endTime ? (endTime - startTime) / 1000 : elapsedTime;
        const minutes = Math.floor(duration / 60);
        const seconds = (duration % 60).toFixed(0);
        const formattedSeconds = seconds.padStart(2, '0');

        if (isOngoing) {
            if (minutes > 0) {
                return `${minutes}:${formattedSeconds}`;
            }
            return `${formattedSeconds}s`;
        } else {
            return `${minutes > 0 ? `${minutes}m ` : ''}${seconds}s`;
        }
    };

    const toggleExpand = () => {
        setIsExpanded(!isExpanded);
    };

    const handleActionClick = (action) => {
        if (action.metadata?.screenshot_base64) {
            onShowScreenshot(action);
        }
        
        // Handle video if present
        if (action.metadata?.screen_recording_base64) {
            onShowVideo(action);
        }
    };

    // Staggered delay for thinking dots
    const getThinkingDotStyle = (index) => ({
        animationDelay: `${index * 0.2}s`
    });

    // Get a summary of the action (first sentence or first 40 chars)
    const getActionSummary = (text) => {
        if (!text) return "";
        const firstSentence = text.split(/[.!?][\s\n]/)[0];
        return firstSentence.length > 40 ? firstSentence.substring(0, 40) + "..." : firstSentence;
    };

    return (
        <div className={`mb-3 rounded-md overflow-hidden border shadow-sm transition-all duration-300 ${
            isOngoing 
                ? 'bg-[#3291ff]/5 border-[#3291ff]/20' 
                : 'bg-[#2A2A2A]/80 border-white/10'
        }`}>
            {/* Header section */}
            <div 
                className={`actions-header flex items-center justify-between py-2 px-3.5 cursor-pointer select-none z-10 relative ${
                    isOngoing 
                        ? isThinking
                            ? 'bg-[#3291ff]/15 text-[#3291ff]'
                            : 'bg-[#3291ff]/10 text-[#3291ff]'
                        : 'bg-[#1d1d1d]/90 text-white/90'
                }`}
                onClick={toggleExpand}
            >
                <div className="flex items-center gap-1.5 overflow-hidden">
                    <div className="flex items-center justify-center w-5 h-5 flex-shrink-0 transition-transform duration-300" 
                        style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
                        <ChevronDown size={16} className="text-white/80" />
                    </div>
                    
                    {isOngoing && isThinking ? (
                        <div className="flex items-center gap-1.5">
                            <div className="flex items-center justify-center w-5 h-5 flex-shrink-0">
                                <Brain size={14} className="thinking-icon text-[#3291ff]" />
                            </div>
                            <span className="text-white/90 text-xs font-medium whitespace-nowrap">Thinking...</span>
                            <div className="thinking-dots-container ml-1">
                                {[0, 1, 2].map((i) => (
                                    <div 
                                        key={i}
                                        className="thinking-dot"
                                        style={getThinkingDotStyle(i)}
                                    />
                                ))}
                            </div>
                        </div>
                    ) : isOngoing && currentAction ? (
                        <div className="flex-1 truncate current-action-text">
                            <span className="text-xs font-medium truncate">
                                {getActionSummary(currentAction.text)}
                            </span>
                        </div>
                    ) : (
                        <span className="text-xs text-white/90 flex items-center gap-1.5">
                            {isOngoing ? (
                                <>
                                    <div className="flex items-center justify-center w-4 h-4 flex-shrink-0">
                                        <Loader2 size={12} className="animate-spin text-[#3291ff]" />
                                    </div>
                                    <span>Executing...</span>
                                </>
                            ) : (
                                <>
                                    <div className="flex items-center justify-center w-4 h-4 flex-shrink-0">
                                        <CheckCheck size={12} className="text-green-400" />
                                    </div>
                                    <span>Execution finished</span>
                                </>
                            )}
                        </span>
                    )}
                </div>
                
                <div className="flex items-center">
                    {isOngoing && (
                        <div className={`text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 font-medium text-white/60 ${
                            isOngoing ? 'bg-white/5' : 'bg-green-500/15 text-green-400'
                        }`}>
                            {formatDuration(actions.start_time, actions.end_time)}
                        </div>
                    )}
                </div>
            </div>

            {/* Progress bar */}
            {isOngoing && (
                <div className="h-[2px] bg-[#222] relative overflow-hidden">
                    <div 
                        className="h-full bg-[#3291ff] transition-all duration-300 ease-out"
                        style={{ width: `${progressPercentage}%` }}
                    />
                    {isThinking && (
                        <div className="absolute top-0 left-0 right-0 bottom-0 bg-[#3291ff]/10">
                            <div className="h-full w-20 animate-[generatePulse_2s_infinite] bg-gradient-to-r from-transparent via-[#3291ff]/40 to-transparent" />
                        </div>
                    )}
                </div>
            )}
            
            {/* Expanded actions list */}
            <div 
                className={`actions-container bg-[#111]/20 transition-all ${
                    isExpanded 
                        ? 'max-h-[300px] opacity-100 border-t border-[#333]/50' 
                        : 'max-h-0 opacity-0 border-t-0'
                }`} 
                ref={actionsListRef}
            >
                <div className="flex flex-col max-h-[300px] scrollbar-thin">
                    {actions.list_of_actions.map((action, index) => {
                        const done = action.end_time && action.end_time <= Date.now();
                        const hasScreenshot = !!action.metadata?.screenshot_base64;
                        const hasVideo = !!action.metadata?.screen_recording_base64;
                        const isActive = !done && !action.end_time;
                        const isLast = index === actions.list_of_actions.length - 1;
                        const isUserNotification = isNotification(action);
                        const isQuestion = isUserQuestion(action);
                        
                        // Special display for notifications and questions
                        if (isUserNotification) {
                            return (
                                <div key={index} className="action-item-container group">
                                    <div className="flex flex-col mx-3 my-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
                                        <div className="flex items-center mb-1">
                                            <AlertCircle size={14} className="text-amber-400 mr-2" />
                                            <span className="text-amber-300 text-xs font-semibold">Important message</span>
                                        </div>
                                        <div className="text-xs text-white/90">
                                            <MarkdownMessage 
                                                content={action.metadata?.notification?.text || action.text} 
                                                compact={false} 
                                            />
                                        </div>
                                    </div>
                                    {!isLast && <div className="action-separator my-0" />}
                                </div>
                            );
                        }
                        
                        if (isQuestion) {
                            return (
                                <div key={index} className="action-item-container group">
                                    <div className="flex flex-col mx-3 my-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
                                        <div className="flex items-center mb-1">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400 mr-2">
                                                <circle cx="12" cy="12" r="10"></circle>
                                                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                                                <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                            </svg>
                                            <span className="text-blue-300 text-xs font-semibold">Question</span>
                                        </div>
                                        <div className="text-xs text-white/90">
                                            <MarkdownMessage 
                                                content={action.metadata?.question?.text || action.text} 
                                                compact={false} 
                                            />
                                        </div>
                                    </div>
                                    {!isLast && <div className="action-separator my-0" />}
                                </div>
                            );
                        }
                        
                        return (
                            <div key={index} className="action-item-container group">
                                <div
                                    className={getActionClassName(action)}
                                    onClick={() => (hasScreenshot || hasVideo) && handleActionClick(action)}
                                >
                                    <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                                        <div
                                            className={`action-status-indicator ${
                                                isActive ? 'active' : done ? 'done' : 'pending'
                                            }`}
                                        >
                                            {isActive && (
                                                <span className="absolute inset-0 rounded-full 
                                                    bg-[#3291ff]/10 animate-ping" />
                                            )}
                                            {done ? (
                                                <CheckCircle2 size={12} className="text-green-400" />
                                            ) : isActive ? (
                                                <Play size={10} className="text-[#3291ff] fill-[#3291ff] animate-pulse" />
                                            ) : (
                                                getActionIcon(action)
                                            )}
                                        </div>
                                    </div>
                                    
                                    <div className={`flex-1 ml-2 text-[11px] leading-tight ${isActive ? 'font-medium' : ''}`}>
                                        <MarkdownMessage content={action.text} compact={true} />
                                    </div>
                                    
                                    <div className="flex items-center gap-1">
                                        {hasVideo && (
                                            <div className="flex items-center justify-center ml-1 w-5 h-5 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/50 group-hover:text-white/80 transition-colors">
                                                    <path d="M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5Z"></path>
                                                    <path d="m10 8 6 4-6 4V8Z"></path>
                                                </svg>
                                            </div>
                                        )}
                                        
                                        {hasScreenshot && (
                                            <div className="flex items-center justify-center ml-1 w-5 h-5 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                                                <Monitor size={10} className="text-white/50 group-hover:text-white/80 transition-colors" />
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {!isLast && <div className="action-separator my-0" />}
                            </div>
                        );
                    })}

                    <div className="h-1"></div>
                </div>
            </div>
        </div>
    );
};

const ChatComponent = forwardRef((props, ref) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentRequest, setCurrentRequest] = useState(null);
    const [isStopping, setIsStopping] = useState(false);
    const messagesEndRef = useRef(null);
    const eventSourceRef = useRef(null);
    const inputRef = useRef(null);
    
    // Use the settings context
    const { openSettings, setIsGenerating } = useSettings();

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    // Scroll to bottom when messages change
    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };
    }, []);

    // Update the isGenerating state in context when currentRequest changes
    useEffect(() => {
        setIsGenerating(!!currentRequest);
        if (!currentRequest) {
            setIsStopping(false);
        }
    }, [currentRequest, setIsGenerating]);

    // On initialization, load history
    useEffect(() => {
        loadHistory();
        
        // Listen for data reset events
        const handleDataReset = () => {
            console.log('Data reset detected, reloading history...');
            loadHistory();
        };
        
        window.addEventListener('data-reset', handleDataReset);
        
        // Cleanup
        return () => {
            window.removeEventListener('data-reset', handleDataReset);
        };
    }, []);

    const loadHistory = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const response = await fetch('http://localhost:2977/history');
            if (!response.ok) {
                throw new Error('Failed to load chat history');
            }
            const history = await response.json();
            setMessages(history);
        } catch (err) {
            console.error('Error loading history:', err);
            setError('Failed to load chat history. Please try again later.');
        } finally {
            setIsLoading(false);
        }
    };

    // Method exposed via ref to send a message from outside
    useImperativeHandle(ref, () => ({
        sendMessage: async (text) => {
            if (text.trim()) {
                await handleSend(text);
            }
        }
    }));

    // Function to update or insert a message by ID
    const upsertMessage = (newMsg) => {
        setMessages((prev) => {
            const existingIndex = prev.findIndex((m) => m.id === newMsg.id);
            if (existingIndex === -1) {
                // new message
                return [...prev, newMsg];
            } else {
                // update
                const updated = [...prev];
                updated[existingIndex] = { ...updated[existingIndex], ...newMsg };
                return updated;
            }
        });

        // If it's a user message, store its ID as the current request
        if (newMsg.sender === 'user' && newMsg.requestId) {
            setCurrentRequest(newMsg.requestId);
        }
        // If it's an assistant message that is no longer generating, reset the current request
        if (newMsg.sender === 'assistant' && !newMsg.is_generating) {
            setCurrentRequest(null);
        }
    };

    const handleStop = async () => {
        if (!currentRequest || isStopping) return;

        setIsStopping(true);
        try {
            const response = await fetch('http://localhost:2977/stop_request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ messageId: currentRequest }),
            });

            if (!response.ok) {
                console.error('Failed to send stop request, status:', response.status);
                setIsStopping(false);
            }

        } catch (error) {
            console.error('Error stopping request:', error);
            setIsStopping(false);
        }
    };

    const handleSend = (textToSend = input) => {
        if (!textToSend.trim()) return;
        setInput('');

        // Use EventSource (SSE) instead of fetch
        const encodedMessage = encodeURIComponent(textToSend);
        const url = `http://localhost:2977/send_message?message=${encodedMessage}`;

        // Close the previous EventSource if it exists
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        const eventSource = new EventSource(url);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
            console.log('SSE connection opened.');
        };

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                upsertMessage(data);
            } catch (err) {
                console.error('Error parsing SSE event data:', err);
            }
        };

        eventSource.addEventListener('error', (e) => {
            console.error('SSE error:', e);
            eventSource.close();
            eventSourceRef.current = null;
            setCurrentRequest(null);
        });

        eventSource.onerror = (e) => {
            console.error('SSE error (onerror):', e);
            eventSource.close();
            eventSourceRef.current = null;
            setCurrentRequest(null);
        };

        eventSource.onend = () => {
            console.log('SSE connection closed.');
            eventSource.close();
            eventSourceRef.current = null;
            setCurrentRequest(null);
        };
    };

    // Focus the input when the component is mounted
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Ctrl+Enter to submit if input is focused
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !currentRequest) {
                e.preventDefault();
                handleSend();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [input, currentRequest]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !currentRequest) {
            e.preventDefault();
            handleSend();
        }
    };

    if (isLoading) {
        return (
            <div className="flex flex-col h-full items-center justify-center bg-[#1A1A1A]">
                <div className="animate-spin w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full mb-3"></div>
                <p className="text-white/70 text-sm">Loading conversation...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-[#1A1A1A] p-6 text-center">
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-5 max-w-md">
                    <p className="text-red-400 mb-4">{error}</p>
                    <button 
                        className="btn btn-secondary flex items-center justify-center gap-2 mx-auto"
                        onClick={loadHistory}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12C2 16.97 6.03 21 11 21C13.39 21 15.68 20.06 17.4 18.4L15 16H21V22L18.9 19.9C16.7 22 13.85 23 11 23C4.92 23 0 18.08 0 12C0 5.92 4.92 1 11 1C15.3 1 19.11 3.37 21 7H18.89C17.15 4.46 14.28 3 11 3C6.03 3 2 7.03 2 12Z" />
                        </svg>
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-[#1A1A1A] text-white h-full flex flex-col p-0">
            <div className="flex items-center justify-between p-3 bg-[#1F1F1F] border-b border-[#333] shadow-sm">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
                    <h2 className="text-white text-base font-medium">Operator</h2>
                </div>
                <button
                    className={`btn btn-ghost btn-icon p-1.5 text-white/60 hover:text-white hover:bg-white/5 ${currentRequest ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    onClick={openSettings}
                    disabled={!!currentRequest}
                    title={currentRequest ? "Settings unavailable during generation" : "Settings"}
                    data-tooltip={currentRequest ? "Settings unavailable during generation" : "Settings"}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 scrollbar-thin">
                {messages.map((msg) => (
                    <div
                        key={msg.id || Math.random()}
                        className={`flex ${msg.sender === 'user' ? 'justify-end' : ''} mb-2 message-appear`}
                    >
                        <div className={`max-w-[80%] rounded-xl text-sm leading-6 ${
                            msg.sender === 'user' 
                                ? 'bg-[#2A2A2A] text-white rounded-xl py-2.5 px-4 shadow-sm' 
                                : 'bg-transparent text-white rounded-xl py-2.5 px-4'
                        } ${msg.error ? 'bg-red-500/10 border-l-3 border-red-500' : ''}`}>
                            {(msg.actions && msg.actions.list_of_actions.length > 0) && (
                                <ActionsList 
                                    actions={msg.actions} 
                                    onShowScreenshot={props.onShowScreenshot}
                                    onShowVideo={props.onShowVideo}
                                />
                            )}
                            <MarkdownMessage content={msg.text || ''} />
                            {(msg.is_generating && (!msg.actions || msg.actions?.list_of_actions?.length === 0 || msg.actions?.end_time)) && 
                                <div className="flex items-center gap-2 text-[#3291ff] text-sm py-2 px-3 bg-[#3291ff]/5 rounded-md mt-3 relative overflow-hidden chat-generating">
                                    Generating...
                                </div>
                            }
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            <div className="px-4 pb-4 pt-2 bg-[#1A1A1A] border-t border-[#333] relative">
                {/* Stop Requested Notification */}
                {isStopping && (
                    <div className="mb-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md flex items-center gap-2">
                        <AlertCircle size={16} className="text-amber-400 flex-shrink-0" />
                        <span className="text-amber-300 text-xs font-medium">
                            Stop requested, the AI will stop after the next action...
                        </span>
                    </div>
                )}

                {/* Input Area */}
                <div className={`input relative flex items-center bg-[#2A2A2A] shadow-md rounded-xl transition-all duration-300 ${currentRequest ? 'opacity-80' : ''}`}>
                    <textarea
                        ref={inputRef}
                        className="flex-1 bg-transparent border-none text-white py-3 pl-4 pr-12 rounded-xl text-sm resize-none max-h-[120px] min-h-[48px] focus:outline-none"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Message Operator"
                        onKeyDown={handleKeyDown}
                        disabled={!!currentRequest}
                        rows={1}
                        style={{ 
                            height: 'auto',
                            overflow: input.split('\n').length > 1 ? 'auto' : 'hidden'
                        }}
                    />
                    <button
                        className={`bg-transparent w-10 h-10 rounded-full flex items-center justify-center p-0 absolute right-1 hover:bg-white/10 transition-opacity ${
                            currentRequest ? 'opacity-100 cursor-pointer' : (input.trim() ? 'opacity-100 cursor-pointer' : 'opacity-50 cursor-not-allowed')
                        }`}
                        onClick={() => currentRequest ? handleStop() : handleSend()}
                        disabled={currentRequest ? false : !input.trim()}
                        title={currentRequest ? "Stop generation" : "Send message"}
                    >
                        {currentRequest ? (
                            // Stop Icon (Square)
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-white">
                                <rect x="6" y="6" width="12" height="12" rx="1"></rect>
                            </svg>
                        ) : (
                            // Send Icon (Paper Plane)
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white">
                                <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
                            </svg>
                        )}
                    </button>
                </div>
                <div className="flex justify-center mt-2">
                    <div className="text-xs text-white/40">
                        {currentRequest
                            ? 'Press the stop button to stop generation'
                            : 'Press Enter to send'}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default ChatComponent;
