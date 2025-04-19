const express = require('express');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');
const sharp = require('sharp');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

const API_KEY = 'zLA_jlURt70ufvlkYmhS5lYvGtgWOVwajrnygq_1dad5eszE2immUrUr8-hvysEe';
const OCR_SERVICE_ID = 'bhashini/iiith-ocr-sceneText-all';
const BHASHINI_API_URL = 'https://dhruva-api.bhashini.gov.in/services/inference/pipeline';

// Optional: Register a font if drawing text doesn't work without it
// registerFont('path/to/your/font.ttf', { family: 'Arial' }); // Optional

router.post('/ocr', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No image uploaded' });
    }

    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Image = imageBuffer.toString('base64');

    const payload = {
      pipelineTasks: [
        {
          taskType: 'ocr',
          config: {
            language: { sourceLanguage: 'mr' },
            serviceId: OCR_SERVICE_ID,
            textDetection: 'False',
          },
        },
        {
          taskType: 'translation',
          config: {
            language: {
              sourceLanguage: 'mr',
              targetLanguage: 'en',
            },
            serviceId: 'ai4bharat/indictrans-v2-all-gpu--t4',
          },
        },
      ],
      inputData: {
        image: [
          {
            imageContent: base64Image,
          },
        ],
      },
    };

    const ocrResponse = await axios.post(BHASHINI_API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${API_KEY}`,
      },
    });

    const outBase64 = ocrResponse.data?.pipelineResponse?.[1]?.output?.[0]?.image?.[0]?.imageContent;

    fs.unlinkSync(req.file.path);

    res.json({
      status: 'success',
      ocrResult: ocrResponse.data,
      translatedImageBase64: outBase64,
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('OCR API Error:', error?.response?.data || error);
    res.status(500).json({
      status: 'error',
      message: 'OCR failed',
      error: error?.response?.data || error.message,
    });
  }
});

module.exports = router;
