const express = require('express');
const multer = require('multer');
const fs = require('fs');
// const axios = require('axios');
const path = require('path');
const { processAudioPipeline } = require('./audioProcessor');
const ocrApp = require('./ocr');
// const {
//   // ensureDevanagariFont,
//   // extractTextElementsFromPDF,
//   // getPDFDimensions,
//   // batchTranslateTextElements,
//   // createTranslatedPDF,
//   translatePDFWithLayout
// } = require('./pdfTranslateHelper');

const app = express();
const upload = multer({ dest: 'uploads/' });
const nodemailer = require('nodemailer');
const emailConfig = require('./email-config');
// const path = require('path');
// const fs = require('fs');
const { translatePDFWithLayout, extractTextElementsFromPDF } = require('./pdfTranslateHelper');
const axios = require('axios');
const { translateImage } = require('./imageTranslateHelper');
const cors = require('cors');
// Middleware for parsing JSON bodies
app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
    res.send('Hello World!');
})

// Mount OCR route
app.use('/', ocrApp);

// const BHASHINI_API_URL = 'https://dhruva-api.bhashini.gov.in/services/inference/pipeline';
const API_KEY = '19cee3351c-515a-4774-b47f-b0ed54859a0c'; // Replace with your key

app.post('/process-audio', upload.single('file'), async (req, res) => {

  const tempDir = path.join(__dirname, 'temp');
  let tempFilePath;

  try {
    // Handle both direct file path and file object
    const fileBuffer = req.file.path ? 
      fs.readFileSync(req.file.path) : 
      req.file.buffer;

    // Create temp file if needed
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Generate unique filename
    const uniqueName = `audio_${Date.now()}_${req.file.originalname}`;
    tempFilePath = path.join(tempDir, uniqueName);

    // Write buffer to temp file
    fs.writeFileSync(tempFilePath, fileBuffer);

    const { sourceLanguage = 'en', targetLanguage = 'en' } = req.body;

    const result = await processAudioPipeline(tempFilePath, {
      sourceLanguage,
      targetLanguage,
      apiKey: API_KEY
    });

    if (result.success) {
      res.json({
        status: 'success',
        data: result
      });
    } else {
      res.status(500).json({
        status: 'error',
        message: result.error
      });
    }
  } catch (error) {
    console.error('Error processing audio:', {
      error: error.message,
      status: error.response?.status,
      data: error.response?.data,
      headers: error.response?.headers,
      config: error.config
    });
    
    console.error('API Error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});


app.post('/translate-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No PDF file uploaded.' });
    }
    
    // Create necessary directories
    const translatedDir = path.join(__dirname, 'translated');
    if (!fs.existsSync(translatedDir)) {
      fs.mkdirSync(translatedDir, { recursive: true });
    }

    const inputPdfPath = req.file.path;
    const outputPdfPath = path.join(translatedDir, `translated_${Date.now()}.pdf`);

    await translatePDFWithLayout(inputPdfPath, outputPdfPath);
    // Wait for the file to be fully written
    await new Promise(resolve => setTimeout(resolve, 5000)); // Increased to 5s

    // Send the file
    res.download(outputPdfPath, 'translated.pdf', (err) => {
      if (err) {
        console.error('Download error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to send translated PDF.' });
        return;
      }

      // Clean up files
      try {
        fs.unlinkSync(inputPdfPath);
        fs.unlinkSync(outputPdfPath);
      } catch (cleanupErr) {
        console.error('Cleanup error:', cleanupErr);
      }
    });
  } catch (error) {
    console.error('PDF Translation API Error:', error);
    
    // Clean up input file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupErr) {
        console.error('Cleanup error:', cleanupErr);
      }
    }

    res.status(500).json({ status: 'error', message: 'Translation failed.' });
  }
});

app.post('/send-mail', upload.single('document'), async (req, res) => {
    try {
        const {
            recipientEmail,
            renewal,
            previousApplicationId,
            sectionLetter,
            dheSanctionId
        } = req.body;

        if (!req.file) {
            return res.status(400).json({ error: 'No document uploaded' });
        }

        if (!recipientEmail || !renewal || !previousApplicationId || !sectionLetter || !dheSanctionId) {
            return res.status(400).json({ status: 'error', message: 'Missing required fields' });
        }

        // Create temporary directories
        // Create temp directory if it doesn't exist
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Translate the uploaded document
        const translatedPdfPath = path.join(tempDir, `translated_${Date.now()}.pdf`);
        await translatePDFWithLayout(req.file.path, translatedPdfPath);

        // Wait for the file to be written
        await new Promise((resolve, reject) => {
            const interval = setInterval(() => {
                if (fs.existsSync(translatedPdfPath)) {
                    clearInterval(interval);
                    resolve();
                }
            }, 100);
            setTimeout(() => {
                clearInterval(interval);
                reject(new Error('File write timeout'));
            }, 30000); // 30 second timeout
        });

        // Read and customize the email template
        const templatePath = path.join(__dirname, 'Email', 'email-template-maha-dbt.html');
        let html = fs.readFileSync(templatePath, 'utf8');
        
        // Replace placeholders in the template
        html = html.replace('{{previousApplicationId}}', previousApplicationId)
                  .replace('{{dheSanctionId}}', dheSanctionId)
                  .replace('{{sectionLetter}}', sectionLetter)
                  .replace('{{renewal}}', renewal);

        // Configure Amazon SES transporter
        const transporter = nodemailer.createTransport({
            host: emailConfig.SMTP_SERVER,
            port: emailConfig.SMTP_PORT,
            secure: false, // use STARTTLS
            auth: {
                user: emailConfig.SMTP_USER,
                pass: emailConfig.SMTP_PASSWORD
            }
        });

        // Prepare attachments
        const attachments = [
            {
                filename: path.basename(req.file.originalname),
                content: fs.readFileSync(translatedPdfPath),
                contentType: 'application/pdf'
            }
        ];

        // Extract text elements from the translated document
        const translatedElements = await extractTextElementsFromPDF(translatedPdfPath);

        // Create translation JSON response
        const translationResponse = {
            document: {
                translated: translatedElements,
                metadata: {
                    sourceLanguage: 'mr',
                    targetLanguage: 'hi',
                    timestamp: new Date().toISOString(),
                    originalFilename: req.file.originalname
                }
            }
        };

        // Send email with only the translated document
        await transporter.sendMail({
            to: recipientEmail,
            from: emailConfig.FROM_EMAIL,
            subject: `Translated Document - ${path.basename(req.file.originalname)}`,
            html,
            attachments
        });
        
        res.json({ 
            status: 'success', 
            message: 'Email sent successfully',
            translation: translationResponse
        });
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ status: 'error', message: 'Failed to send email' });
    }
});

const { convertTextToSpeech } = require('./ttsHelper');

app.post('/tts', async (req, res) => {
    try {
        const response = await convertTextToSpeech(req.body);
        res.json(response);
    } catch (error) {
        console.error('Error in TTS:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(4000, () => console.log('[INFO] Server started on http://localhost:4000'));
