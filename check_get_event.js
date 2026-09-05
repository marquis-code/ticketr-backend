async function run() {
  const fetch = require('node-fetch');
  const res = await fetch('http://localhost:3000/events/6a795ed229b9220ed488653e', {
    headers: { Authorization: `Bearer null` } // this will fail auth, but we can see what it does
  });
  console.log(await res.text());
}
run();
