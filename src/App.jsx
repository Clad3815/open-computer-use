import React, { useState, useContext, createContext } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import SplitLayout from './components/SplitLayout';
import SettingsPanel from './components/SettingsPanel';
import './App.css';

// Create a context for settings management
export const SettingsContext = createContext({
  isSettingsOpen: false,
  openSettings: () => {},
  closeSettings: () => {},
  isGenerating: false,
  setIsGenerating: () => {}
});

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const openSettings = () => setIsSettingsOpen(true);
  const closeSettings = () => setIsSettingsOpen(false);

  return (
    <SettingsContext.Provider value={{ 
      isSettingsOpen, 
      openSettings, 
      closeSettings, 
      isGenerating, 
      setIsGenerating 
    }}>
      <Router>
        <div className="h-screen">
          <Routes>
            <Route path="/" element={<SplitLayout />} />
          </Routes>
          
          {/* Settings panel rendered at the root level */}
          <SettingsPanel 
            isOpen={isSettingsOpen} 
            onClose={closeSettings} 
            isGenerating={isGenerating} 
          />
        </div>
      </Router>
    </SettingsContext.Provider>
  );
}

// Custom hook to use settings context
export const useSettings = () => useContext(SettingsContext);

export default App;
