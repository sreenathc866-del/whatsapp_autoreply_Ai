const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

const filesToTest = ['q1.wav', 'q2.wav', 'q3.wav'];

async function runVoicePipelineTest() {
  console.log("Starting Complete Voice Pipeline Test...\n");

  for (const file of filesToTest) {
    const absolutePath = path.join(__dirname, file);
    
    if (!fs.existsSync(absolutePath)) {
      console.error(`File not found: ${absolutePath}`);
      continue;
    }

    console.log(`===========================================`);
    console.log(`Testing with file: ${file}`);
    console.log(`===========================================`);

    try {
      const formData = new FormData();
      formData.append('audio', fs.createReadStream(absolutePath));

      const response = await axios.post('http://localhost:3000/api/test-voice', formData, {
        headers: formData.getHeaders(),
        maxBodyLength: Infinity,
      });

      console.log('Transcription:', response.data.transcription);
      console.log('Gemini Answer:', response.data.answer);
      console.log('Context Found:', response.data.contextUsed);
      console.log('Audio File:', response.data.audioFile);
      console.log('\n');
    } catch (error) {
      console.error('--- Error ---');
      if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Data:', JSON.stringify(error.response.data, null, 2));
      } else {
        console.error(error.message);
      }
      console.log('\n');
    }
  }
}

runVoicePipelineTest();
