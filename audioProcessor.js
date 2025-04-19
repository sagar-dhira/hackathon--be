const axios = require('axios');
const fs = require('fs');

// Audio Model Configurations
const AUDIO_MODELS = {
  INDIAN_LANGUAGES: {
    asrServiceId: 'ai4bharat/conformer-multilingual-indo_aryan-gpu--t4',
    nmtServiceId: 'ai4bharat/indictrans-v2-all-gpu--t4', 
    ttsServiceId: 'ai4bharat/indic-tts-coqui-indo_aryan-gpu--t4'
  },
  ENGLISH: {
    asrServiceId: 'ai4bharat/whisper-medium-en--gpu--t4',
    nmtServiceId: 'ai4bharat/indictrans-v2-all-gpu--t4',
    ttsServiceId: 'ai4bharat/indic-tts-coqui-indo_aryan-gpu--t4'
  }
};

const BHASHINI_API_URL = 'https://dhruva-api.bhashini.gov.in/services/inference/pipeline';

/**
 * Processes audio through Bhashini's ASR → Translation → TTS pipeline
 * @param {Object} file - Uploaded file object with path property
 * @param {Object} options - Processing options
 * @param {string} options.sourceLanguage - Source language code (default: 'hi')
 * @param {string} options.targetLanguage - Target language code (default: 'en')
 * @param {string} options.modelType - Model configuration type (default: 'INDIAN_LANGUAGES')
 * @param {string} options.apiKey - Bhashini API key
 * @returns {Promise<Object>} - API response data
 */
async function processAudioPipeline(tempFilePath, options = {}) {
  const {
    sourceLanguage = 'en',
    targetLanguage = 'hi',
    apiKey
  } = options;

  try {
    // Convert MP3 to WAV using ffmpeg
    const { spawn } = require('child_process');
    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    const tempWavPath = tempFilePath.replace(/\.[^/.]+$/, "") + '.wav';
    const tempFlacPath = tempFilePath.replace(/\.[^/.]+$/, "") + '.flac';

    // Convert MP3 to WAV
    const ffmpeg = spawn(ffmpegPath, [
      '-i', tempFilePath,
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      tempWavPath
    ]);

    await new Promise((resolve, reject) => {
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Failed to convert MP3 to WAV'));
        }
      });
    });

    // Convert WAV to FLAC
    const ffmpeg2 = spawn(ffmpegPath, [
      '-i', tempWavPath,
      '-c:a', 'flac',
      '-ar', '16000',
      tempFlacPath
    ]);

    await new Promise((resolve, reject) => {
      ffmpeg2.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Failed to convert WAV to FLAC'));
        }
      });
    });

    // Read the FLAC file
    const fileBuffer = fs.readFileSync(tempFlacPath);
    const base64Content = fileBuffer.toString('base64');

    // Clean up temporary files
    fs.unlinkSync(tempWavPath);
    fs.unlinkSync(tempFlacPath);

    const payload = {
      pipelineTasks: [
        {
          taskType: "asr",
          config: {
            language: { sourceLanguage: sourceLanguage },
            serviceId: 'ai4bharat/whisper-medium-en--gpu--t4',
            audioFormat: "flac", 
            samplingRate: 16000
          }
        },
        {
          taskType: "translation",
          config: {
            language: {
              sourceLanguage: sourceLanguage,
              targetLanguage: targetLanguage
            },
            serviceId: 'ai4bharat/indictrans-v2-all-gpu--t4'
          }
        },
        {
          taskType: "tts",
          config: {
            language: { sourceLanguage: targetLanguage },
            serviceId: 'Bhashini/IITM/TTS',
            gender: "male",
            samplingRate: 8000
          }
        }
      ],
      inputData: {
        audio: [
          {
            audioContent: base64Content
          }
        ]
      }
    };

    // Make API call
    const response = await axios.post(
      BHASHINI_API_URL,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `aPiteHrq99sLfQkCZga9sBTPjqGU4ivk2mZfbbeZKKncdmART6JOgdt6qx4ea2ei`
        }
      }
    );

    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    console.error('Audio processing error:', error.response);
    throw error;
  } finally {
    // Clean up uploaded file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

module.exports = {
  AUDIO_MODELS,
  processAudioPipeline
}
