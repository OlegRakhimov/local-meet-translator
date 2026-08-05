const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAssistantSettings, sanitizeSuggestion, createAssistantOverlayController } = require('../src/main/assistant-overlay');

test('assistant settings keep AI auto-analysis enabled whenever the assistant is enabled', () => {
  const settings = normalizeAssistantSettings({}, 'win32');
  assert.equal(settings.enabled, true);
  assert.equal(settings.autoAnalyze, true);
  assert.equal(settings.contentProtection, true);
  assert.equal(settings.languageLevel, 'B1');
});

test('suggestion sanitizer bounds structured content', () => {
  const suggestion = sanitizeSuggestion({ source:'library', firstSentence:'Start.', answer:'Answer.', keyPoints:['One'], basis:['Fact'], confidence:'high' });
  assert.equal(suggestion.source, 'library');
  assert.deepEqual(suggestion.keyPoints, ['One']);
  assert.equal(suggestion.confidence, 'high');
});

test('controller applies content protection and keeps question local', async () => {
  const calls = [];
  class FakeWindow {
    constructor(options) { this.options=options; this.visible=false; this.destroyed=false; this.protected=false; this.webContents={ isDestroyed:()=>false, send:(...args)=>calls.push(args), on:()=>{} }; }
    setAlwaysOnTop(){} setContentProtection(v){this.protected=v;} isContentProtected(){return this.protected;}
    setIgnoreMouseEvents(){} setOpacity(){} loadFile(){return Promise.resolve();} on(){} isDestroyed(){return this.destroyed;}
    isVisible(){return this.visible;} showInactive(){this.visible=true;} show(){this.visible=true;} hide(){this.visible=false;}
    getNormalBounds(){return {x:0,y:0,width:600,height:700};} setBounds(){} destroy(){this.destroyed=true;}
  }
  const controller = createAssistantOverlayController({
    BrowserWindow:FakeWindow,
    screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1600,height:900}}),getAllDisplays:()=>[{workArea:{x:0,y:0,width:1600,height:900}}],on:()=>{}},
    globalShortcut:{register:()=>true,unregister:()=>{}}, preloadPath:'preload', htmlPath:'html', statePath:'',
    loadSettings:()=>({INTERVIEW_ASSISTANT_ENABLED:'true',INTERVIEW_ASSISTANT_CONTENT_PROTECTION:'true'}), saveSettings:()=>{}, platform:'win32'
  });
  controller.initialize();
  controller.setQuestion({id:'q',text:'Tell me about yourself'});
  assert.equal(controller.snapshot().question.text, 'Tell me about yourself');
  assert.equal(controller.snapshot().protection.applied, true);
  assert.ok(calls.some(call => call[0] === 'assistant-overlay:state'));
});

test('ready assistant answer stays pinned until the user loads a different answer', () => {
  class FakeWindow {
    constructor() { this.visible=false; this.destroyed=false; this.protected=false; this.webContents={ isDestroyed:()=>false, send:()=>{}, on:()=>{} }; }
    setAlwaysOnTop(){} setContentProtection(v){this.protected=v;} isContentProtected(){return this.protected;}
    setIgnoreMouseEvents(){} setOpacity(){} loadFile(){return Promise.resolve();} on(){} isDestroyed(){return this.destroyed;}
    isVisible(){return this.visible;} showInactive(){this.visible=true;} show(){this.visible=true;} hide(){this.visible=false;}
    getNormalBounds(){return {x:0,y:0,width:680,height:780};} setBounds(){} destroy(){this.destroyed=true;}
  }
  const controller = createAssistantOverlayController({
    BrowserWindow:FakeWindow,
    screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1600,height:900}}),getAllDisplays:()=>[{workArea:{x:0,y:0,width:1600,height:900}}],on:()=>{}},
    globalShortcut:{register:()=>true,unregister:()=>{}}, preloadPath:'preload', htmlPath:'html', statePath:'',
    loadSettings:()=>({INTERVIEW_ASSISTANT_ENABLED:'true'}), saveSettings:()=>{}, platform:'win32'
  });
  controller.initialize();
  controller.setQuestion({id:'q1',text:'First question?'});
  controller.setSuggestion({question:'First question?',answer:'First answer.',firstSentence:'First answer.'});
  assert.equal(controller.snapshot().teleprompter.answerLocked, true);
  controller.setQuestion({id:'q2',text:'Second question?'});
  controller.setSuggestion({question:'Second question?',answer:'Second answer.',firstSentence:'Second answer.'});
  assert.equal(controller.snapshot().suggestion.question, 'First question?');
  assert.equal(controller.snapshot().teleprompter.pending.suggestion.question, 'Second question?');
  controller.loadPending();
  assert.equal(controller.snapshot().suggestion.question, 'Second question?');
});

test('pending generation errors stay visible and can be dismissed without clearing the current answer', () => {
  class FakeWindow {
    constructor() { this.visible=false; this.destroyed=false; this.protected=false; this.webContents={ isDestroyed:()=>false, send:()=>{}, on:()=>{} }; }
    setAlwaysOnTop(){} setContentProtection(v){this.protected=v;} isContentProtected(){return this.protected;}
    setMovable(){} setIgnoreMouseEvents(){} setOpacity(){} loadFile(){return Promise.resolve();} on(){} isDestroyed(){return this.destroyed;}
    isVisible(){return this.visible;} showInactive(){this.visible=true;} show(){this.visible=true;} hide(){this.visible=false;}
    getNormalBounds(){return {x:0,y:0,width:680,height:780};} setBounds(){} destroy(){this.destroyed=true;}
  }
  const controller = createAssistantOverlayController({
    BrowserWindow:FakeWindow,
    screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1600,height:900}}),getAllDisplays:()=>[{workArea:{x:0,y:0,width:1600,height:900}}],on:()=>{}},
    globalShortcut:{register:()=>true,unregister:()=>{}}, preloadPath:'preload', htmlPath:'html', statePath:'',
    loadSettings:()=>({INTERVIEW_ASSISTANT_ENABLED:'true'}), saveSettings:()=>{}, platform:'win32'
  });
  controller.initialize();
  controller.setQuestion({id:'q1',text:'First question?'});
  controller.setSuggestion({question:'First question?',answer:'First answer.',firstSentence:'First answer.'});
  controller.setQuestion({id:'q2',text:'Second question?'});
  controller.setAnalyzing(true);
  controller.setError('Request timed out.');

  const failed = controller.snapshot();
  assert.equal(failed.suggestion.question, 'First question?');
  assert.equal(failed.teleprompter.pendingQuestion.text, 'Second question?');
  assert.equal(failed.teleprompter.pendingAnalyzing, false);
  assert.equal(failed.pendingError, 'Request timed out.');

  controller.dismissPending();
  const dismissed = controller.snapshot();
  assert.equal(dismissed.suggestion.question, 'First question?');
  assert.equal(dismissed.teleprompter.pendingQuestion, null);
  assert.equal(dismissed.pendingError, '');
});

test('finishing an answer preserves active coding focus', () => {
  class FakeWindow {
    constructor() { this.visible=false; this.destroyed=false; this.protected=false; this.webContents={ isDestroyed:()=>false, send:()=>{}, on:()=>{} }; }
    setAlwaysOnTop(){} setContentProtection(v){this.protected=v;} isContentProtected(){return this.protected;}
    setMovable(){} setIgnoreMouseEvents(){} setOpacity(){} loadFile(){return Promise.resolve();} on(){} isDestroyed(){return this.destroyed;}
    isVisible(){return this.visible;} showInactive(){this.visible=true;} show(){this.visible=true;} hide(){this.visible=false;}
    getNormalBounds(){return {x:0,y:0,width:680,height:780};} setBounds(){} destroy(){this.destroyed=true;}
  }
  const controller = createAssistantOverlayController({
    BrowserWindow:FakeWindow,
    screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1600,height:900}}),getAllDisplays:()=>[{workArea:{x:0,y:0,width:1600,height:900}}],on:()=>{}},
    globalShortcut:{register:()=>true,unregister:()=>{}}, preloadPath:'preload', htmlPath:'html', statePath:'',
    loadSettings:()=>({INTERVIEW_ASSISTANT_ENABLED:'true'}), saveSettings:()=>{}, platform:'win32'
  });
  controller.initialize();
  controller.setQuestion({id:'coding',text:'Implement a queue.',kind:'coding-task'});
  controller.setSuggestion({question:'Implement a queue.',responseType:'coding_solution',answer:'Use two stacks.',firstSentence:'I will use two stacks.'});
  assert.equal(controller.snapshot().codingFocus.active, true);

  controller.finishAnswer();
  const finished = controller.snapshot();
  assert.equal(finished.teleprompter.current, null);
  assert.equal(finished.suggestion.question, 'Implement a queue.');
  assert.equal(finished.codingFocus.active, true);
  assert.equal(finished.mode, 'CODING');
  assert.equal(finished.visible, true);
});

test('move mode temporarily restores mouse interaction and remains movable', () => {
  const ignoreCalls = [];
  let movable = false;
  class FakeWindow {
    constructor() { this.visible=false; this.destroyed=false; this.protected=false; this.webContents={ isDestroyed:()=>false, send:()=>{}, on:()=>{} }; }
    setAlwaysOnTop(){} setContentProtection(v){this.protected=v;} isContentProtected(){return this.protected;}
    setMovable(value){movable=value;} setIgnoreMouseEvents(value){ignoreCalls.push(value);} setOpacity(){} loadFile(){return Promise.resolve();} on(){} isDestroyed(){return this.destroyed;}
    isVisible(){return this.visible;} showInactive(){this.visible=true;} show(){this.visible=true;} focus(){} hide(){this.visible=false;}
    getNormalBounds(){return {x:0,y:0,width:680,height:780};} setBounds(){} destroy(){this.destroyed=true;}
  }
  const controller = createAssistantOverlayController({
    BrowserWindow:FakeWindow,
    screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1600,height:900}}),getAllDisplays:()=>[{workArea:{x:0,y:0,width:1600,height:900}}],on:()=>{}},
    globalShortcut:{register:()=>true,unregister:()=>{}}, preloadPath:'preload', htmlPath:'html', statePath:'',
    loadSettings:()=>({INTERVIEW_ASSISTANT_CLICK_THROUGH:'true'}), saveSettings:()=>{}, platform:'win32'
  });
  controller.initialize();
  controller.setMoveMode(true);
  assert.equal(controller.snapshot().moveMode, true);
  assert.equal(movable, true);
  assert.equal(ignoreCalls.at(-1), false);
  controller.setMoveMode(false);
  assert.equal(ignoreCalls.at(-1), true);
});

test('sanitizes structured coding guidance for the protected overlay', () => {
  const { sanitizeSuggestion } = require('../src/main/assistant-overlay');
  const value = sanitizeSuggestion({
    responseType: 'coding_solution',
    question: 'Write a Java method.',
    firstSentence: 'I will start with a clear plan.',
    answer: 'I will create a helper method and call it from main.',
    approachSummary: 'Use nested loops for a simple baseline solution.',
    implementationPlan: ['Create main', 'Create the array', 'Compare values'],
    codeLanguage: 'java',
    code: 'public class Main {}',
    codeWalkthrough: ['Line 1: declares the class.'],
    complexity: 'Time O(n^2), space O(1).',
    edgeCases: ['Empty array'],
    speakingNotes: ['First, I create main.']
  });
  assert.equal(value.responseType, 'coding_solution');
  assert.equal(value.codeLanguage, 'java');
  assert.match(value.code, /public class Main/);
  assert.deepEqual(value.implementationPlan, ['Create main', 'Create the array', 'Compare values']);
});


test('assistant mode follows waiting, answering, next question and coding transitions', () => {
  class FakeWindow {
    constructor() { this.visible=false; this.destroyed=false; this.protected=false; this.webContents={ isDestroyed:()=>false, send:()=>{}, on:()=>{} }; }
    setAlwaysOnTop(){} setContentProtection(v){this.protected=v;} isContentProtected(){return this.protected;}
    setMovable(){} setIgnoreMouseEvents(){} setOpacity(){} loadFile(){return Promise.resolve();} on(){} isDestroyed(){return this.destroyed;}
    isVisible(){return this.visible;} showInactive(){this.visible=true;} show(){this.visible=true;} hide(){this.visible=false;}
    getNormalBounds(){return {x:0,y:0,width:680,height:780};} setBounds(){} destroy(){this.destroyed=true;}
  }
  const controller = createAssistantOverlayController({
    BrowserWindow:FakeWindow,
    screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1600,height:900}}),getAllDisplays:()=>[{workArea:{x:0,y:0,width:1600,height:900}}],on:()=>{}},
    globalShortcut:{register:()=>true,unregister:()=>{}}, preloadPath:'preload', htmlPath:'html', statePath:'',
    loadSettings:()=>({INTERVIEW_ASSISTANT_ENABLED:'true'}), saveSettings:()=>{}, platform:'win32'
  });
  controller.initialize();
  assert.equal(controller.snapshot().mode, 'WAITING');
  controller.setQuestion({id:'q1',text:'First question?'});
  controller.setSuggestion({question:'First question?',answer:'First answer.',firstSentence:'First answer.'});
  assert.equal(controller.snapshot().mode, 'ANSWERING');
  controller.setQuestion({id:'q2',text:'Second question?'});
  controller.setSuggestion({question:'Second question?',answer:'Second answer.',firstSentence:'Second answer.'});
  assert.equal(controller.snapshot().mode, 'NEXT_QUESTION_READY');
  controller.nextQuestion();
  assert.equal(controller.snapshot().mode, 'ANSWERING');
  controller.finishAnswer();
  assert.equal(controller.snapshot().mode, 'WAITING');
  assert.equal(controller.snapshot().visible, true);
  controller.setQuestion({id:'coding',text:'Implement a stack.',kind:'coding-task'});
  controller.setSuggestion({question:'Implement a stack.',responseType:'coding_solution',answer:'Use an array.',firstSentence:'I will use an array.'});
  assert.equal(controller.snapshot().mode, 'CODING');
  controller.setPendingCodingChange({classification:{category:'mandatory_condition'},utterance:{text:'Do not use a library stack.'}});
  assert.equal(controller.snapshot().mode, 'CODING_CHANGE_READY');
  controller.clearPendingCodingChange();
  controller.setPendingCodingTask({id:'new',text:'Reverse a linked list.',kind:'coding-task'});
  assert.equal(controller.snapshot().mode, 'NEW_CODING_TASK_READY');
  controller.finishCodingTask();
  assert.equal(controller.snapshot().mode, 'WAITING');
  assert.equal(controller.snapshot().visible, true);
});

test('utterance feed is available outside coding focus', () => {
  class FakeWindow {
    constructor() { this.visible=false; this.destroyed=false; this.protected=false; this.webContents={ isDestroyed:()=>false, send:()=>{}, on:()=>{} }; }
    setAlwaysOnTop(){} setContentProtection(v){this.protected=v;} isContentProtected(){return this.protected;}
    setIgnoreMouseEvents(){} setOpacity(){} loadFile(){return Promise.resolve();} on(){} isDestroyed(){return this.destroyed;}
    isVisible(){return this.visible;} showInactive(){this.visible=true;} show(){this.visible=true;} hide(){this.visible=false;}
    getNormalBounds(){return {x:0,y:0,width:680,height:780};} setBounds(){} destroy(){this.destroyed=true;}
  }
  const controller = createAssistantOverlayController({
    BrowserWindow:FakeWindow,
    screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1600,height:900}}),getAllDisplays:()=>[{workArea:{x:0,y:0,width:1600,height:900}}],on:()=>{}},
    globalShortcut:{register:()=>true,unregister:()=>{}}, preloadPath:'preload', htmlPath:'html', statePath:'',
    loadSettings:()=>({INTERVIEW_ASSISTANT_ENABLED:'true'}), saveSettings:()=>{}, platform:'win32'
  });
  controller.initialize();
  controller.addUtterance({id:'u1',text:'Okay, tell me about yourself.',kind:'question'});
  assert.equal(controller.snapshot().utteranceFeed.length, 1);
  assert.equal(controller.snapshot().utteranceFeed[0].kind, 'question');
  assert.equal(controller.snapshot().codingFocus.active, false);
});

test('assistant window starts larger and supports plus/minus resizing within display limits', () => {
  let createdOptions = null;
  class FakeWindow {
    constructor(options) {
      createdOptions = options;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.visible = false;
      this.destroyed = false;
      this.protected = false;
      this.webContents = { isDestroyed: () => false, send: () => {}, on: () => {} };
    }
    setAlwaysOnTop() {} setContentProtection(value) { this.protected = value; } isContentProtected() { return this.protected; }
    setMovable() {} setIgnoreMouseEvents() {} setOpacity() {} loadFile() { return Promise.resolve(); } on() {} isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; } showInactive() { this.visible = true; } show() { this.visible = true; } hide() { this.visible = false; }
    getNormalBounds() { return { ...this.bounds }; } setBounds(bounds) { this.bounds = { ...bounds }; } destroy() { this.destroyed = true; }
  }
  const display = { workArea: { x: 0, y: 0, width: 1600, height: 1000 } };
  const controller = createAssistantOverlayController({
    BrowserWindow: FakeWindow,
    screen: {
      getPrimaryDisplay: () => display,
      getDisplayMatching: () => display,
      getAllDisplays: () => [display],
      on: () => {}
    },
    globalShortcut: { register: () => true, unregister: () => {} },
    preloadPath: 'preload', htmlPath: 'html', statePath: '',
    loadSettings: () => ({ INTERVIEW_ASSISTANT_ENABLED: 'true' }), saveSettings: () => {}, platform: 'win32'
  });
  controller.initialize();
  controller.ensureWindow();
  assert.equal(createdOptions.width, 760);
  assert.equal(createdOptions.height, 820);
  assert.equal(createdOptions.minWidth, 520);
  assert.equal(createdOptions.minHeight, 500);

  const enlarged = controller.resizeWindow(1).bounds;
  assert.equal(enlarged.width, 860);
  assert.equal(enlarged.height, 900);

  const reduced = controller.resizeWindow(-1).bounds;
  assert.equal(reduced.width, 760);
  assert.equal(reduced.height, 820);

  for (let index = 0; index < 10; index += 1) controller.resizeWindow(-1);
  const minimum = controller.snapshot();
  const bounds = controller.getWindow().getNormalBounds();
  assert.equal(bounds.width, 520);
  assert.equal(bounds.height, 500);
  assert.equal(minimum.visible, false);
});
