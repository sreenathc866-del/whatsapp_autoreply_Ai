const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

async function runSttTest() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.log("Usage: node test-stt.js <path_to_audio_file>");
    console.log("Example: node test-stt.js sample.mp3");
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  console.log(`Testing /api/test-stt with file: ${absolutePath}`);

  try {
    const formData = new FormData();
    formData.append('audio', fs.createReadStream(absolutePath));

    const response = await axios.post('http://localhost:3000/api/test-stt', formData, {
      headers: formData.getHeaders(),
      maxBodyLength: Infinity,
    });

    console.log('\n--- Success! ---');
    console.log('Transcription:', response.data.transcription);
    console.log('\nGemini Answer:', response.data.answer);
    console.log('------------------\n');
  } catch (error) {
    console.error('\n--- Error ---');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

runSttTest();
