const { spawn } = require('child_process');

// Capture the target script from the command line arguments
// Usage: node dev-runner.js <your-script.js>
const targetScript = process.argv[2];

if (!targetScript) {
  console.error('\x1b[31m%s\x1b[0m', 'Error: Please provide a target script.');
  console.log('Usage: node dev-runner.js <filename>');
  process.exit(1);
}

let child = null;
let debugMode = true;

const start = () => {
  if (child) {
    child.kill();
  }

  // Construct args: node [--inspect] targetScript
  const args = debugMode ? ['--inspect=9229', targetScript] : [targetScript];
  
  console.log('\x1b[33m%s\x1b[0m', `\n--- [${new Date().toLocaleTimeString()}] Running: ${targetScript} (${debugMode ? 'DEBUG ON' : 'DEBUG OFF'}) ---`);

  child = spawn('node', args, {
    stdio: 'inherit',
    shell: true
  });

  child.on('close', (code) => {
    if (code !== null && code !== 0) {
      console.log('\x1b[31m%s\x1b[0m', `\nProcess crashed with code ${code}.`);
    }
  });
};

// UI and Input Setup
console.clear();
console.log('\x1b[36m%s\x1b[0m', `
=========================================
  Dev Runner: ${targetScript}
=========================================
  Commands:
  [r] Restart / Recompile
  [d] Toggle Debug (Current: ${debugMode ? 'ON' : 'OFF'})
  [ctrl+c] Exit
=========================================
`);

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', (key) => {
  const input = key.toString().toLowerCase();

  if (input === 'r') {
    start();
  } 
  else if (input === 'd') {
    debugMode = !debugMode;
    console.log(`\x1b[35m%s\x1b[0m`, `\n> Debugging ${debugMode ? 'Enabled' : 'Disabled'}`);
    start();
  } 
  else if (key === '\u0003') { // Ctrl+C
    if (child) child.kill();
    process.exit();
  }
});

start();