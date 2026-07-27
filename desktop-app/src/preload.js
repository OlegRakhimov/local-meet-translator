const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lmt', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  diagnosticsLoad: () => ipcRenderer.invoke('diagnostics:load'),
  diagnosticsRun: () => ipcRenderer.invoke('diagnostics:run'),
  diagnosticsResetTransient: () => ipcRenderer.invoke('diagnostics:reset-transient'),
  diagnosticsExport: (format) => ipcRenderer.invoke('diagnostics:export', format || 'json'),
  sessionStatus: () => ipcRenderer.invoke('session:status'),
  setWorkspaceDirty: (state) => ipcRenderer.send('workspace:dirty-state', state || {}),
  subtitleStatus: () => ipcRenderer.invoke('subtitle-overlay:status'),
  subtitleControl: (action, payload = {}) => ipcRenderer.invoke('subtitle-overlay:control', action, payload),
  interviewAssistantStatus: () => ipcRenderer.invoke('interview-assistant:status'),
  interviewAssistantControl: (action, payload = {}) => ipcRenderer.invoke('interview-assistant:control', action, payload),
  interviewAssistantAnalyze: (question) => ipcRenderer.invoke('interview-assistant:analyze', question || ''),
  interviewAssistantLastQuestion: () => ipcRenderer.invoke('interview-assistant:last-question'),
  candidateProfileLoad: () => ipcRenderer.invoke('candidate-profile:load'),
  candidateProfileSave: (profile) => ipcRenderer.invoke('candidate-profile:save', profile || {}),
  candidateProfileReset: () => ipcRenderer.invoke('candidate-profile:reset'),
  candidateProfileImport: () => ipcRenderer.invoke('candidate-profile:import'),
  candidateProfileExport: (profile) => ipcRenderer.invoke('candidate-profile:export', profile || {}),
  answerLibraryLoad: () => ipcRenderer.invoke('answer-library:load'),
  answerLibrarySave: (library) => ipcRenderer.invoke('answer-library:save', library || {}),
  answerLibraryGenerateLearningAids: (entry) => ipcRenderer.invoke('answer-library:generate-learning-aids', entry || {}),
  answerLibraryReset: () => ipcRenderer.invoke('answer-library:reset'),
  answerLibraryImport: () => ipcRenderer.invoke('answer-library:import'),
  answerLibraryExport: (library) => ipcRenderer.invoke('answer-library:export', library || {}),
  liveInterviewLoad: () => ipcRenderer.invoke('live-interview:load'),
  liveInterviewStart: (details) => ipcRenderer.invoke('live-interview:start', details || {}),
  liveInterviewEnd: (sessionId) => ipcRenderer.invoke('live-interview:end', sessionId || ''),
  liveInterviewUpdate: (session) => ipcRenderer.invoke('live-interview:update', session || {}),
  liveInterviewReset: () => ipcRenderer.invoke('live-interview:reset'),
  liveInterviewExport: (format, data) => ipcRenderer.invoke('live-interview:export', format || 'md', data || {}),
  interviewTrainingLoad: () => ipcRenderer.invoke('interview-training:load'),
  interviewTrainingSave: (data) => ipcRenderer.invoke('interview-training:save', data || {}),
  interviewTrainingReset: () => ipcRenderer.invoke('interview-training:reset'),
  interviewTrainingExport: (format, data) => ipcRenderer.invoke('interview-training:export', format || 'md', data || {}),
  load: () => ipcRenderer.invoke('settings:load'),
  save: (settings) => ipcRenderer.invoke('settings:save', settings),
  startBridge: () => ipcRenderer.invoke('bridge:start'),
  stopBridge: () => ipcRenderer.invoke('bridge:stop'),
  startVoice: () => ipcRenderer.invoke('voice:start'),
  stopVoice: () => ipcRenderer.invoke('voice:stop'),
  health: () => ipcRenderer.invoke('health:check'),
  checkCable: () => ipcRenderer.invoke('audio:checkCable'),
  openExtension: () => ipcRenderer.invoke('extension:open'),
  startTranslation: (options) => ipcRenderer.invoke('extension:startTranslation', options || {}),
  stopTranslation: () => ipcRenderer.invoke('extension:stopTranslation'),
  openEnv: () => ipcRenderer.invoke('env:open'),
  onLog: (cb) => {
    const handler = (_event, line) => cb(line);
    ipcRenderer.on('app:log', handler);
    return () => ipcRenderer.removeListener('app:log', handler);
  },
  onInterviewQuestion: (cb) => {
    const handler = (_event, question) => cb(question);
    ipcRenderer.on('interview:question-detected', handler);
    return () => ipcRenderer.removeListener('interview:question-detected', handler);
  },
  onInterviewAssistantState: (cb) => {
    const handler = (_event, state) => cb(state);
    ipcRenderer.on('interview:assistant-state', handler);
    return () => ipcRenderer.removeListener('interview:assistant-state', handler);
  },
  onLiveInterviewState: (cb) => {
    const handler = (_event, state) => cb(state);
    ipcRenderer.on('interview:session-state', handler);
    return () => ipcRenderer.removeListener('interview:session-state', handler);
  }
});
