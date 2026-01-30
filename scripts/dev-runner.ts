import { spawn } from 'child_process';



const targetScript = process.argv[2];

if (!targetScript) {
  console.error('\x1b[31m%s\x1b[0m', 'Error: Please provide a target script.');
  process.exit(1);
}

let child = null;

const start = () => {
  if (child) child.kill();

  const debugArgs = process.execArgv.filter(arg => 
    arg.startsWith('--inspect') || 
    arg.startsWith('--inspect-brk') ||
    arg.startsWith('--debug')
  );

  const args = [
    "--no-warnings",
    "--enable-source-maps",
    "-r", "dotenv/config", 
    targetScript
  ];

  console.log('\x1b[33m%s\x1b[0m', `\n--- [${new Date().toLocaleTimeString()}] Running: ${targetScript} ---`);

  child = spawn('node', args, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: {
      NODE_ENV: "development",
      ...process.env,
      FORCE_COLOR: "1",
    }
  });

  child.on('close', (code) => {
    if (code !== null && code !== 0) {
      console.log('\x1b[31m%s\x1b[0m', `\nProcess crashed with code ${code}.`);
    }
  });
};

// UI and Input Setup (No changes needed here)
console.clear();
console.log('\x1b[36m%s\x1b[0m', `
=========================================
  Dev Runner: ${targetScript}
=========================================
  Commands: [r] Restart | [ctrl+c] Exit
=========================================
`);

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key) => {
    if (key.toString().toLowerCase() === 'r') start();

    else if (key === '\u0003') {
      if (child) child.kill();
      process.exit();
    }
  });
}

start();