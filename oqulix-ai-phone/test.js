const http = require('http');

const questions = [
  "What services does Oqulix provide?",
  "Can you build a mobile application?",
  "I need an e-commerce website.",
  "What solutions do you offer?",
  "How can I contact Oqulix?",
  "Tell me about your services.",
  "How much does a spaceship cost?" // Testing hallucination prevention
];

function askQuestion(question) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ question });

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/test-ai',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });

    req.on('error', (error) => reject(error));
    req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log("Starting tests...\n");
  for (const q of questions) {
    console.log(`Q: ${q}`);
    try {
      const response = await askQuestion(q);
      console.log(`A: ${response.answer}\n`);
    } catch (e) {
      console.error(`Error requesting answer:`, e.message);
    }
  }
  console.log("Tests completed.");
}

runTests();
