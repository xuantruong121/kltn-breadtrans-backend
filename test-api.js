fetch('http://localhost:3001/gamification/pet/feed', { method: 'POST' })
  .then(res => res.json().then(data => ({status: res.status, data})))
  .then(console.log)
  .catch(console.error);
