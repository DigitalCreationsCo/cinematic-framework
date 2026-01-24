
import * as url from 'url';

console.log('import.meta:', import.meta);
console.log('import.meta.main:', import.meta.main);
console.log('process.argv[ 0 ]: ', process.argv[ 0 ]);
console.log('process.argv[ 1 ]: ', process.argv[ 1 ]);
if (process.argv[ 1 ] === url.fileURLToPath(import.meta.url)) {
    console.log('Standard Node check: This is the main module');
} else {
    console.log('Standard Node check: This is NOT the main module');
}
