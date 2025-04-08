import React, { useState, useEffect, useRef } from 'react';
import { X, Save, RefreshCw, ToggleLeft, ToggleRight, Settings as SettingsIcon, Check, AlertTriangle } from 'lucide-react';
import axios from 'axios';

const SettingsPanel = ({ isOpen, onClose, isGenerating }) => {
  const [settings, setSettings] = useState({
    AI_MODEL: "google/gemini-2.0-pro-exp-02-05",
    TEMPERATURE: 0.7,
    SEND_SCREENSHOT: true,
    SEND_PARSED_SCREENSHOT: false,
    CONVERT_SCREENSHOT_TO_DESCRIPTION: false,
    MAX_IMAGES_IN_HISTORY: 3,
    MAX_SCREEN_INFO_IN_HISTORY: 10,
    MAX_SITUATION_ANALYSIS_IN_HISTORY: 10,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [activeSection, setActiveSection] = useState('general');
  const modalRef = useRef(null);

  // List of available models
  const availableModels = [
    { value: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "google/gemini-2.5-pro-exp-03-25", label: "Gemini 2.5 Pro (Experimental 03/25)" },
    { value: "google/gemini-2.0-pro-exp-02-05", label: "Gemini 2.0 Pro (Experimental 02/05)" },
    { value: "openai/gpt-4o", label: "GPT-4o" },
    { value: "openai/o1", label: "o1" },
    { value: "openai/o3-mini", label: "o3-mini" },
    { value: "openai/o3-mini-low", label: "o3-mini-low" },
    { value: "openai/o3-mini-high", label: "o3-mini-high" },
    { value: "anthropic/claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet" },
    { value: "anthropic/claude-3-7-sonnet-latest-thinking", label: "Claude 3.7 Sonnet Thinking" },
  ];

  // Navigation sections
  const sections = [
    { id: 'general', label: 'General', icon: 'settings' },
    { id: 'screenshots', label: 'Screenshots', icon: 'image' },
    { id: 'history', label: 'History', icon: 'history' },
    { id: 'data', label: 'Data', icon: 'database' }
  ];

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target) && !isGenerating && !saving) {
        onClose();
      }
    }
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose, isGenerating, saving]);

  // Handle escape key
  useEffect(() => {
    function handleEscapeKey(event) {
      if (event.key === 'Escape' && !isGenerating && !saving) {
        onClose();
      }
    }
    
    if (isOpen) {
      document.addEventListener('keydown', handleEscapeKey);
    }
    
    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isOpen, onClose, isGenerating, saving]);

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
    }
  }, [isOpen]);

  const fetchSettings = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.get('http://localhost:2977/settings');
      setSettings(response.data);
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      setError('Failed to load settings. Using defaults.');
      // Keep using default settings
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage('');

    try {
      await axios.post('http://localhost:2977/settings', settings);
      setSuccessMessage('Settings saved successfully!');
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccessMessage('');
      }, 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError('Error saving settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const resetData = async () => {
    if (!window.confirm('Are you sure you want to delete all data? This action is irreversible.')) {
      return;
    }
    
    setError(null);
    setSuccessMessage('');
    setSaving(true);
    
    try {
      await axios.post('http://localhost:2977/reset_data');
      setSuccessMessage('Data deleted successfully!');
      
      // Dispatch a custom event to inform other components
      const resetEvent = new CustomEvent('data-reset');
      window.dispatchEvent(resetEvent);
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccessMessage('');
      }, 3000);
    } catch (err) {
      console.error('Failed to reset data:', err);
      setError('Error deleting data. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const renderSectionIcon = (iconName) => {
    switch (iconName) {
      case 'settings':
        return (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        );
      case 'image':
        return (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
        );
      case 'history':
        return (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0"></path>
            <polyline points="12 7 12 12 15 15"></polyline>
          </svg>
        );
      case 'database':
        return (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
          </svg>
        );
      default:
        return null;
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex justify-center items-center h-[300px]">
          <div className="flex flex-col items-center">
            <RefreshCw size={30} className="animate-spin text-white/70 mb-3" />
            <p className="text-white/60 text-sm">Loading settings...</p>
          </div>
        </div>
      );
    }

    switch (activeSection) {
      case 'general':
        return (
          <div className="space-y-8 animate-fadeIn">
            {/* Model Selection */}
            <div className="space-y-4">
              <h3 className="text-white text-base font-medium border-b border-[#333] pb-2">
                AI Model
              </h3>
              <div className="space-y-4">
                <div className="flex flex-col gap-2">
                  <label htmlFor="ai-model" className="text-white/80 text-sm">Select the AI model</label>
                  <p className="text-white/50 text-xs mb-2">Choose which AI model will process your requests</p>
                  <select 
                    id="ai-model"
                    className="bg-[#2D2D2D] text-white border border-[#444] rounded-md p-2.5 focus:outline-none focus:border-[#666] focus-ring"
                    value={settings.AI_MODEL}
                    onChange={(e) => handleChange('AI_MODEL', e.target.value)}
                    disabled={isGenerating || saving}
                  >
                    {availableModels.map(model => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-white/40 text-xs mt-2 italic">
                    Note: Different models have different capabilities and costs.
                  </p>
                </div>
              </div>
            </div>

            {/* Temperature Control */}
            <div className="space-y-4">
              <h3 className="text-white text-base font-medium border-b border-[#333] pb-2">
                Creativity
              </h3>
              <div className="space-y-4">
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <label htmlFor="temperature" className="text-white/80 text-sm">Temperature</label>
                    <span className="text-white/80 text-sm font-mono bg-[#2D2D2D] px-2 py-1 rounded">
                      {settings.TEMPERATURE.toFixed(1)}
                    </span>
                  </div>
                  <p className="text-white/50 text-xs mb-2">
                    Controls the creativity level of responses (0.0 = precise, 1.0 = creative)
                  </p>
                  <div className="relative flex items-center">
                    <span className="text-white/50 text-xs absolute left-0 -bottom-5">Precise</span>
                    <input
                      id="temperature"
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={settings.TEMPERATURE}
                      onChange={(e) => handleChange('TEMPERATURE', parseFloat(e.target.value))}
                      className="w-full h-2 bg-[#2D2D2D] rounded-lg appearance-none cursor-pointer focus:outline-none focus-ring disabled:opacity-50"
                      disabled={isGenerating || saving}
                    />
                    <span className="text-white/50 text-xs absolute right-0 -bottom-5">Creative</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      
      case 'screenshots':
        return (
          <div className="space-y-8 animate-fadeIn">
            {/* Screenshot Settings */}
            <div className="space-y-6">
              <div className="flex items-center justify-between group">
                <div>
                  <label className="text-white/80 text-sm">Send screenshots</label>
                  <p className="text-white/50 text-xs mt-1">Send the current screen to the AI model</p>
                </div>
                <button 
                  className="bg-transparent border-none p-0 flex items-center text-white/90 focus:outline-none focus-ring rounded-full"
                  onClick={() => handleChange('SEND_SCREENSHOT', !settings.SEND_SCREENSHOT)}
                  disabled={isGenerating || saving}
                >
                  {settings.SEND_SCREENSHOT ? 
                    <ToggleRight size={36} className="text-[#3291ff] transition-all duration-200" /> : 
                    <ToggleLeft size={36} className="text-white/60 transition-all duration-200 group-hover:text-white/80" />
                  }
                </button>
              </div>

              <div className="flex items-center justify-between group">
                <div>
                  <label className="text-white/80 text-sm">Send parsed screenshots</label>
                  <p className="text-white/50 text-xs mt-1">Send a version of the screen with detected elements highlighted</p>
                </div>
                <button 
                  className="bg-transparent border-none p-0 flex items-center text-white/90 focus:outline-none focus-ring rounded-full"
                  onClick={() => handleChange('SEND_PARSED_SCREENSHOT', !settings.SEND_PARSED_SCREENSHOT)}
                  disabled={isGenerating || saving || !settings.SEND_SCREENSHOT}
                >
                  {settings.SEND_PARSED_SCREENSHOT ? 
                    <ToggleRight size={36} className="text-[#3291ff] transition-all duration-200" /> : 
                    <ToggleLeft size={36} className={`text-white/60 transition-all duration-200 ${!settings.SEND_SCREENSHOT ? 'opacity-40' : 'group-hover:text-white/80'}`} />
                  }
                </button>
              </div>

              <div className="flex items-center justify-between group">
                <div>
                  <label className="text-white/80 text-sm">Convert screenshots to text</label>
                  <p className="text-white/50 text-xs mt-1">Convert images to text descriptions (useful for models without image support)</p>
                </div>
                <button 
                  className="bg-transparent border-none p-0 flex items-center text-white/90 focus:outline-none focus-ring rounded-full"
                  onClick={() => handleChange('CONVERT_SCREENSHOT_TO_DESCRIPTION', !settings.CONVERT_SCREENSHOT_TO_DESCRIPTION)}
                  disabled={isGenerating || saving || !settings.SEND_SCREENSHOT}
                >
                  {settings.CONVERT_SCREENSHOT_TO_DESCRIPTION ? 
                    <ToggleRight size={36} className="text-[#3291ff] transition-all duration-200" /> : 
                    <ToggleLeft size={36} className={`text-white/60 transition-all duration-200 ${!settings.SEND_SCREENSHOT ? 'opacity-40' : 'group-hover:text-white/80'}`} />
                  }
                </button>
              </div>
            </div>
          </div>
        );
      
      case 'history':
        return (
          <div className="space-y-8 animate-fadeIn">
            {/* History Settings */}
            <div className="space-y-6">
              <div className="flex flex-col gap-2">
                <label className="text-white/80 text-sm">Max images in history</label>
                <p className="text-white/50 text-xs mb-2">Limit the number of screenshot images kept in the conversation history</p>
                <div className="relative">
                  <input 
                    type="number" 
                    className="bg-[#2D2D2D] text-white border border-[#444] rounded-md p-2.5 w-full focus:outline-none focus:border-[#666] focus-ring"
                    value={settings.MAX_IMAGES_IN_HISTORY}
                    onChange={(e) => handleChange('MAX_IMAGES_IN_HISTORY', parseInt(e.target.value) || 0)}
                    min="1"
                    max="10"
                    disabled={isGenerating || saving}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2 text-white/50">
                    <button 
                      className="p-1 hover:bg-white/10 rounded focus:outline-none focus-ring disabled:opacity-50"
                      onClick={() => handleChange('MAX_IMAGES_IN_HISTORY', Math.max(1, settings.MAX_IMAGES_IN_HISTORY - 1))}
                      disabled={settings.MAX_IMAGES_IN_HISTORY <= 1 || isGenerating || saving}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14"></path>
                      </svg>
                    </button>
                    <button 
                      className="p-1 hover:bg-white/10 rounded focus:outline-none focus-ring disabled:opacity-50"
                      onClick={() => handleChange('MAX_IMAGES_IN_HISTORY', Math.min(10, settings.MAX_IMAGES_IN_HISTORY + 1))}
                      disabled={settings.MAX_IMAGES_IN_HISTORY >= 10 || isGenerating || saving}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14"></path>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-white/80 text-sm">Max screen info in history</label>
                <p className="text-white/50 text-xs mb-2">Limit the number of screen descriptions kept in memory</p>
                <div className="relative">
                  <input 
                    type="number" 
                    className="bg-[#2D2D2D] text-white border border-[#444] rounded-md p-2.5 w-full focus:outline-none focus:border-[#666] focus-ring"
                    value={settings.MAX_SCREEN_INFO_IN_HISTORY}
                    onChange={(e) => handleChange('MAX_SCREEN_INFO_IN_HISTORY', parseInt(e.target.value) || 0)}
                    min="1"
                    max="20"
                    disabled={isGenerating || saving}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2 text-white/50">
                    <button 
                      className="p-1 hover:bg-white/10 rounded focus:outline-none focus-ring disabled:opacity-50"
                      onClick={() => handleChange('MAX_SCREEN_INFO_IN_HISTORY', Math.max(1, settings.MAX_SCREEN_INFO_IN_HISTORY - 1))}
                      disabled={settings.MAX_SCREEN_INFO_IN_HISTORY <= 1 || isGenerating || saving}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14"></path>
                      </svg>
                    </button>
                    <button 
                      className="p-1 hover:bg-white/10 rounded focus:outline-none focus-ring disabled:opacity-50"
                      onClick={() => handleChange('MAX_SCREEN_INFO_IN_HISTORY', Math.min(20, settings.MAX_SCREEN_INFO_IN_HISTORY + 1))}
                      disabled={settings.MAX_SCREEN_INFO_IN_HISTORY >= 20 || isGenerating || saving}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14"></path>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-white/80 text-sm">Max situation analyses in history</label>
                <p className="text-white/50 text-xs mb-2">Limit the number of AI analyses kept in the conversation history</p>
                <div className="relative">
                  <input 
                    type="number" 
                    className="bg-[#2D2D2D] text-white border border-[#444] rounded-md p-2.5 w-full focus:outline-none focus:border-[#666] focus-ring"
                    value={settings.MAX_SITUATION_ANALYSIS_IN_HISTORY}
                    onChange={(e) => handleChange('MAX_SITUATION_ANALYSIS_IN_HISTORY', parseInt(e.target.value) || 0)}
                    min="1"
                    max="20"
                    disabled={isGenerating || saving}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2 text-white/50">
                    <button 
                      className="p-1 hover:bg-white/10 rounded focus:outline-none focus-ring disabled:opacity-50"
                      onClick={() => handleChange('MAX_SITUATION_ANALYSIS_IN_HISTORY', Math.max(1, settings.MAX_SITUATION_ANALYSIS_IN_HISTORY - 1))}
                      disabled={settings.MAX_SITUATION_ANALYSIS_IN_HISTORY <= 1 || isGenerating || saving}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14"></path>
                      </svg>
                    </button>
                    <button 
                      className="p-1 hover:bg-white/10 rounded focus:outline-none focus-ring disabled:opacity-50"
                      onClick={() => handleChange('MAX_SITUATION_ANALYSIS_IN_HISTORY', Math.min(20, settings.MAX_SITUATION_ANALYSIS_IN_HISTORY + 1))}
                      disabled={settings.MAX_SITUATION_ANALYSIS_IN_HISTORY >= 20 || isGenerating || saving}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14"></path>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      
      case 'data':
        return (
          <div className="space-y-8 animate-fadeIn">
            <div className="space-y-4">
              <h3 className="text-white text-base font-medium border-b border-[#333] pb-2">
                Data Management
              </h3>
              <div className="space-y-4">
                <div className="flex flex-col gap-2">
                  <p className="text-white/80 text-sm">Delete conversation history</p>
                  <p className="text-white/50 text-xs mb-4">
                    This action will permanently delete all conversation history and screen analyses. 
                    The application will restart with an empty history.
                  </p>
                  <button
                    className="bg-red-600 text-white py-2.5 px-4 rounded-md hover:bg-red-700 transition-colors duration-200 focus:outline-none focus-ring flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={resetData}
                    disabled={isGenerating || saving}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                      <line x1="10" y1="11" x2="10" y2="17"></line>
                      <line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                    {saving ? 'Deleting...' : 'Delete all data'}
                  </button>
                  <p className="text-white/40 text-xs mt-2 italic">
                    Note: This operation cannot be undone. All conversation data will be lost.
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex justify-center items-center z-[9999] p-4 modal-overlay animate-fadeIn">
      <div 
        ref={modalRef}
        className="modal-content bg-[#1E1E1E] rounded-lg w-full max-w-[800px] max-h-[90vh] shadow-lg flex flex-col overflow-hidden animate-scale"
      >
        {/* Header */}
        <div className="p-5 border-b border-[#333] flex justify-between items-center">
          <div className="flex items-center gap-2">
            <SettingsIcon size={20} className="text-white/80" />
            <h2 className="text-white text-lg font-medium">Settings</h2>
          </div>
          <button 
            className="btn btn-ghost btn-icon p-1.5 hover:bg-white/10 rounded-full transition-colors"
            onClick={onClose}
            disabled={isGenerating || saving}
            title={isGenerating || saving ? "Cannot close while processing" : "Close"}
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-52 border-r border-[#333] p-3 space-y-1 bg-[#1A1A1A]">
            {sections.map(section => (
              <button
                key={section.id}
                className={`w-full flex items-center gap-3 p-2.5 rounded-md text-left text-sm font-medium transition-colors focus:outline-none focus-ring ${
                  activeSection === section.id 
                    ? 'bg-[#333] text-white active-highlight' 
                    : 'text-white/70 hover:bg-[#333]/50 hover:text-white'
                }`}
                onClick={() => setActiveSection(section.id)}
                disabled={isGenerating || saving}
              >
                {renderSectionIcon(section.icon)}
                {section.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
            {renderContent()}

            {/* Error and Success Messages */}
            {error && (
              <div className="mt-6 p-3 bg-red-500/10 border border-red-500/30 rounded-md flex items-start gap-3 animate-fadeIn">
                <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-red-400 text-sm">{error}</div>
              </div>
            )}
            
            {successMessage && (
              <div className="mt-6 p-3 bg-green-500/10 border border-green-500/30 rounded-md flex items-start gap-3 animate-fadeIn">
                <Check size={20} className="text-green-400 flex-shrink-0 mt-0.5" />
                <div className="text-green-400 text-sm">{successMessage}</div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#333] flex justify-end items-center bg-[#1E1E1E] shadow-md">
          <button 
            className="btn btn-primary py-2.5 px-6 flex items-center gap-2"
            onClick={saveSettings}
            disabled={isGenerating || saving}
          >
            {saving ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save size={16} />
                <span>Save</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel; 