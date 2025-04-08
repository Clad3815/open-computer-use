import React, { useState, useRef, useEffect } from 'react';
import ChatComponent from './ChatComponent';
import VncViewer from './VncViewer';

const SplitLayout = () => {
  const [isControlEnabled, setIsControlEnabled] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    // Try to get saved width from localStorage
    const savedWidth = localStorage.getItem('leftPanelWidth');
    return savedWidth ? parseInt(savedWidth, 10) : 500; // Default to 500px
  });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);
  const chatRef = useRef();
  const vncRef = useRef();
  const initialX = useRef(0);
  const initialWidth = useRef(0);
  
  // Save width to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('leftPanelWidth', leftPanelWidth.toString());
  }, [leftPanelWidth]);

  // Add a class to body when dragging to prevent text selection
  useEffect(() => {
    if (isDragging) {
      document.body.classList.add('select-none');
    } else {
      document.body.classList.remove('select-none');
    }
    
    return () => {
      document.body.classList.remove('select-none');
    };
  }, [isDragging]);

  const handleControlToggle = (enabled) => {
    setIsControlEnabled(enabled);
  };

  const handleSendMessage = (message) => {
    if (chatRef.current && message) {
      chatRef.current.sendMessage(message);
    }
  };

  const handleShowScreenshot = (action) => {
    if (vncRef.current?.handleShowAction) {
      vncRef.current.handleShowAction(action);
    }
  };

  const handleShowVideo = (video, screenshot) => {
    if (vncRef.current?.handleShowVideo) {
      vncRef.current.handleShowVideo(video, screenshot);
    }
  };

  const startResize = (e) => {
    e.preventDefault();
    initialX.current = e.clientX;
    initialWidth.current = leftPanelWidth;
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    
    const handleMouseMove = (e) => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const minWidth = Math.max(200, containerWidth * 0.15); // Min 15% of container
        const maxWidth = Math.min(800, containerWidth * 0.7); // Max 70% of container
        
        const dx = e.clientX - initialX.current;
        const newWidth = initialWidth.current + dx;
        const clampedWidth = Math.min(Math.max(newWidth, minWidth), maxWidth);
        setLeftPanelWidth(clampedWidth);
      }
    };
    
    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div 
      ref={containerRef} 
      className="flex h-screen bg-[#1A1A1A] relative"
    >
      <div 
        className={`${isControlEnabled ? 'w-0 opacity-0' : ''} min-w-[200px] max-w-[800px] border-r border-[#333] transition-all duration-300 ease-in-out relative`}
        style={{ width: isControlEnabled ? 0 : `${leftPanelWidth}px` }}
      >
        <ChatComponent 
          ref={chatRef} 
          onShowScreenshot={handleShowScreenshot}
          onShowVideo={handleShowVideo}
        />
      </div>

      {!isControlEnabled && (
        <div 
          onMouseDown={startResize}
          className={`splitter w-[6px] absolute top-0 bottom-0 z-20 group ${isDragging ? 'splitter-active' : ''}`}
          style={{ left: `${leftPanelWidth - 3}px` }}
        >
          <div className="absolute inset-0 flex items-center justify-center h-full pointer-events-none">
            <div className="w-[1px] h-[40px] bg-white/20 rounded-full group-hover:h-[60px] group-hover:bg-white/40 transition-all duration-200"></div>
          </div>
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
            <div className="w-[4px] h-full bg-white/5"></div>
          </div>
        </div>
      )}

      <div 
        className={`flex-1 transition-all duration-300 relative ${isControlEnabled ? 'w-full' : ''}`}
        style={{ 
          marginLeft: isControlEnabled ? 0 : undefined,
        }}
      >
        <VncViewer 
          ref={vncRef}
          onControlChange={handleControlToggle} 
          onSendMessage={handleSendMessage}
        />
      </div>
    </div>
  );
};

export default SplitLayout; 