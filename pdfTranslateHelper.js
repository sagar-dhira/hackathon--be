// Helper functions for Marathi to Hindi PDF translation with layout preservation using Bhashini
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const PDFDocument = require("pdfkit");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

// Fix for PDF.js worker
const PDFJS_WORKER_PATH = path.join(
  process.cwd(),
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.js"
);
if (fs.existsSync(PDFJS_WORKER_PATH)) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_PATH;
} else {
  pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/build/pdf.worker.js"
  );
}

const BHASHINI_API_KEY =
  "zLA_jlURt70ufvlkYmhS5lYvGtgWOVwajrnygq_1dad5eszE2immUrUr8-hvysEe";
const BHASHINI_API_ENDPOINT =
  "https://dhruva-api.bhashini.gov.in/services/inference/pipeline";
const SOURCE_LANGUAGE = "mr";
const TARGET_LANGUAGE = "hi";

const HINDI_FONT_PATH = path.join(
  __dirname,
  "fonts/NotoSansDevanagari-Regular.ttf"
);
const HINDI_FONT_BOLD_PATH = path.join(
  __dirname,
  "fonts/NotoSansDevanagari-Bold.ttf"
);

async function ensureDevanagariFont() {
  const fontsDir = path.join(__dirname, "fonts");

  if (!fs.existsSync(fontsDir)) {
    fs.mkdirSync(fontsDir, { recursive: true });
  }

  if (!fs.existsSync(HINDI_FONT_PATH)) {
    console.log("Downloading Noto Sans Devanagari Regular font...");
    const fontUrl =
      "https://fonts.gstatic.com/s/notosansdevanagari/v19/TuGOUUk6hG0ZmCpvLS_T-gsinh1DAmOLDqULTSapqo4.ttf";
    const fontResponse = await axios.get(fontUrl, {
      responseType: "arraybuffer",
    });
    fs.writeFileSync(HINDI_FONT_PATH, fontResponse.data);
  }

  // Download bold font if not present
  if (!fs.existsSync(HINDI_FONT_BOLD_PATH)) {
    console.log("Downloading Noto Sans Devanagari Bold font...");
    const fontUrl =
      "https://fonts.gstatic.com/s/notosansdevanagari/v19/TuGWUUk6hG0ZmCpvLS_T-gsinNZRkI3u-lOTqDYoxvA.ttf";
    const fontResponse = await axios.get(fontUrl, {
      responseType: "arraybuffer",
    });
    fs.writeFileSync(HINDI_FONT_BOLD_PATH, fontResponse.data);
  }

  console.log("Devanagari fonts ready");
}

async function extractTextElementsFromPDF(pdfPath) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const loadingTask = pdfjsLib.getDocument({ data: dataBuffer });
  const pdf = await loadingTask.promise;
  let textElements = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    textContent.items.forEach((item) => {
      if (!item.transform || item.transform.length < 6) return;
      const transform = item.transform;
      const [scaleX, skewY, skewX, scaleY, posX, posY] = transform;
      let fontSize = 12;
      try {
        fontSize = Math.sqrt(scaleX * scaleX + skewX * skewX);
        if (!fontSize || isNaN(fontSize) || fontSize < 1) fontSize = 12;
      } catch (e) {
        fontSize = 12;
      }
      textElements.push({
        text: item.str || "",
        page: pageNum,
        x: posX || 0,
        y: posY || 0,
        fontSize: fontSize,
        width: item.width || 100,
        height: item.height || 15,
        fontName: item.fontName || "unknown",
        fontWeight:
          item.fontName && item.fontName.toLowerCase().includes("bold")
            ? "bold"
            : "normal",
      });
    });
  }
  return textElements;
}

async function getPDFDimensions(pdfPath) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const loadingTask = pdfjsLib.getDocument({ data: dataBuffer });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.0 });
  return {
    width: viewport.width,
    height: viewport.height,
    numPages: pdf.numPages,
  };
}

async function batchTranslateTextElements(textElements) {
  const textStrings = textElements
    .map((element) => element.text)
    .filter((text) => text && text.trim().length > 0);

  if (textStrings.length === 0) {
    console.log("No text to translate");
    return textElements;
  }

  const CHUNK_SIZE = 20;
  const textChunks = [];

  for (let i = 0; i < textStrings.length; i += CHUNK_SIZE) {
    textChunks.push(textStrings.slice(i, i + CHUNK_SIZE));
  }

  let translatedStrings = [];

  for (let i = 0; i < textChunks.length; i++) {
    const chunk = textChunks[i];
    console.log(`Translating chunk ${i + 1}/${textChunks.length} (${chunk.length} items)`);
    try {
      const response = await axios.post(
        BHASHINI_API_ENDPOINT,
        {
          pipelineTasks: [
            {
              taskType: "translation",
              config: {
                language: {
                  sourceLanguage: SOURCE_LANGUAGE,
                  targetLanguage: TARGET_LANGUAGE,
                },
              },
            },
          ],
          inputData: {
            input: chunk.map((text) => ({ source: text })),
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: ` ${BHASHINI_API_KEY}`,
          },
        }
      );
      const output = response.data.pipelineResponse[0].output;
      console.log(output,'out')
      if (Array.isArray(output)) {
        const chunkTranslations = output.map((item) => item.target || "");
        translatedStrings = translatedStrings.concat(chunkTranslations);
      } else {
        console.warn("Unexpected response structure from Bhashini API:", response.data);
        translatedStrings = translatedStrings.concat(chunk); // fallback
      }

      await new Promise((resolve) => setTimeout(resolve, 300)); // Rate limiting
    } catch (error) {
      console.error("Error translating chunk:", error.message);
      console.error("Response data:", error?.response?.data);
      translatedStrings = translatedStrings.concat(chunk); // fallback
    }
  }

  let translatedElements = [];
  let translationIndex = 0;

  textElements.forEach((element) => {
    if (element.text && element.text.trim().length > 0) {
      const translatedElement = {
        ...element,
        originalText: element.text,
        text: translatedStrings[translationIndex] || element.text,
      };
      translatedElements.push(translatedElement);
      translationIndex++;
    } else {
      translatedElements.push(element);
    }
  });

  return translatedElements;
}

function createTranslatedPDF(translatedElements, pdfDimensions, outputPath) {
  const doc = new PDFDocument({
    size: [pdfDimensions.width, pdfDimensions.height],
    autoFirstPage: false,
    bufferPages: true // Important for managing multiple pages
  });
  
  try {
    // Register Hindi fonts
    doc.registerFont('DevanagariRegular', HINDI_FONT_PATH);
    doc.registerFont('DevanagariBold', HINDI_FONT_BOLD_PATH);
    
    const outputStream = fs.createWriteStream(outputPath);
    outputStream.on('error', err => {
      console.error('Error writing to output file:', err);
    });
    
    doc.pipe(outputStream);
    
    // Group elements by page
    const elementsByPage = {};
    translatedElements.forEach(element => {
      if (!elementsByPage[element.page]) {
        elementsByPage[element.page] = [];
      }
      elementsByPage[element.page].push(element);
    });
    
    // Process each page
    for (let pageNum = 1; pageNum <= pdfDimensions.numPages; pageNum++) {
      doc.addPage({
        size: [pdfDimensions.width, pdfDimensions.height],
        margin: 0
      });
      
      const pageElements = elementsByPage[pageNum] || [];
      
      // Draw each text element
      pageElements.forEach(element => {
        try {
          // Skip elements with invalid positions
          if (isNaN(element.x) || isNaN(element.y) || isNaN(element.fontSize)) {
            return;
          }
          
          // Flip Y-coordinate (PDF coordinate system starts from bottom-left)
          const y = pdfDimensions.height - element.y;
          
          // Choose appropriate Devanagari font based on original font weight
          const fontName = element.fontWeight === 'bold' ? 'DevanagariBold' : 'DevanagariRegular';
          
          // Skip empty text
          if (!element.text || element.text.trim() === '') {
            return;
          }
          
          doc.font(fontName)
             .fontSize(element.fontSize)
             .text(element.text, element.x, y, {
               width: element.width * 1.2, // Slightly wider for Hindi text
               align: 'left',
               lineBreak: false
             });
        } catch (err) {
          console.warn(`Error placing text element on page ${pageNum}:`, err.message);
        }
      });
    }
    
    doc.end();
    console.log(`Translated PDF created: ${outputPath}`);
    return true;
  } catch (error) {
    console.error('Error creating PDF:', error);
    
    // Try to close the document in case of error
    try {
      doc.end();
    } catch (e) {
      // Ignore
    }
  }
}
// const inputPdfPath = path.join(__dirname, 'GR.pdf');
// const outputPdfPath = path.join(__dirname, 'marathi_to_hindi_translated1.pdf');

// Run the translation process
async function translatePDFWithLayout(inputPdfPath, outputPdfPath) {
  try {
    ensureDevanagariFont();
    const textElements = await extractTextElementsFromPDF(inputPdfPath);
    const pdfDimensions = await getPDFDimensions(inputPdfPath);
    const translatedElements = await batchTranslateTextElements(textElements);
    const result = await createTranslatedPDF(
      translatedElements,
      pdfDimensions,
      outputPdfPath
    );
    // console.log(
    //   "PDF translation process completed",
    //   result,
    //   translatedElements
    // );
    return result;
    // return new Promise(async (resolve, reject) => {
    //   try {
    //     const result = await createTranslatedPDF(translatedElements, pdfDimensions, outputPdfPath);
    //     resolve(result);
    //   } catch (error) {
    //     reject(error);
    //   }
    // });
  } catch (error) {
    console.error("PDF translation process failed:", error);
    throw error;
  }
}

module.exports = {
  ensureDevanagariFont,
  extractTextElementsFromPDF,
  getPDFDimensions,
  batchTranslateTextElements,
  createTranslatedPDF,
  translatePDFWithLayout,
};
