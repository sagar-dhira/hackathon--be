const fs = require("fs");
const path = require("path");
const axios = require("axios");
const PDFDocument = require("pdfkit");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

// PDF.js worker setup
pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(
  process.cwd(),
  "node_modules/pdfjs-dist/build/pdf.worker.js"
);

const BHASHINI_API_ENDPOINT = "https://dhruva-api.bhashini.gov.in/services/inference/pipeline";

// Font paths
const DEVANAGARI_FONT_PATH = path.join(__dirname, "fonts/NotoSansDevanagari-Regular.ttf");
const DEVANAGARI_BOLD_PATH = path.join(__dirname, "fonts/NotoSansDevanagari-Bold.ttf");

async function ensureDevanagariFont() {
  const fontsDir = path.join(__dirname, "fonts");
  if (!fs.existsSync(fontsDir)) {
    fs.mkdirSync(fontsDir, { recursive: true });
  }

  if (!fs.existsSync(DEVANAGARI_FONT_PATH)) {
    console.log("Downloading Noto Sans Devanagari Regular font...");
    const fontUrl = "https://fonts.gstatic.com/s/notosansdevanagari/v19/TuGOUUk6hG0ZmCpvLS_T-gsinh1DAmOLDqULTSapqo4.ttf";
    const fontResponse = await axios.get(fontUrl, { responseType: "arraybuffer" });
    fs.writeFileSync(DEVANAGARI_FONT_PATH, fontResponse.data);
  }

  if (!fs.existsSync(DEVANAGARI_BOLD_PATH)) {
    console.log("Downloading Noto Sans Devanagari Bold font...");
    const fontUrl = "https://fonts.gstatic.com/s/notosansdevanagari/v19/TuGWUUk6hG0ZmCpvLS_T-gsinNZRkI3u-lOTqDYoxvA.ttf";
    const fontResponse = await axios.get(fontUrl, { responseType: "arraybuffer" });
    fs.writeFileSync(DEVANAGARI_BOLD_PATH, fontResponse.data);
  }
}

async function extractTextElementsFromPDF(pdfPath) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const loadingTask = pdfjsLib.getDocument({ data: dataBuffer });
  const pdf = await loadingTask.promise;
  
  let textElements = [];
  const pageTextPromises = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    pageTextPromises.push(
      pdf.getPage(pageNum).then(async (page) => {
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });

        textContent.items.forEach((item) => {
          if (!item.transform || item.transform.length < 6) return;

          const [scaleX, skewY, skewX, scaleY, posX, posY] = item.transform;
          let fontSize = Math.max(
            Math.sqrt(scaleX * scaleX + skewX * skewX),
            Math.sqrt(scaleY * scaleY + skewY * skewY)
          ) || 12;

          textElements.push({
            text: item.str || "",
            page: pageNum,
            x: posX,
            y: viewport.height - posY, // Convert to top-left origin
            fontSize: fontSize,
            width: item.width || 100,
            height: item.height || fontSize * 1.2,
            fontName: item.fontName || "unknown",
            fontWeight: item.fontName && item.fontName.toLowerCase().includes("bold") ? "bold" : "normal",
          });
        });
      })
    );
  }

  await Promise.all(pageTextPromises);
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

async function batchTranslateTextElements(textElements, options = {}) {
  const { sourceLanguage, targetLanguage } = options;

  const textStrings = textElements
    .map((element) => element.text)
    .filter((text) => text && text.trim().length > 0);

  if (textStrings.length === 0) return textElements;

  const CHUNK_SIZE = 5;
  const textChunks = [];
  
  for (let i = 0; i < textStrings.length; i += CHUNK_SIZE) {
    textChunks.push(textStrings.slice(i, i + CHUNK_SIZE));
  }

  let translatedStrings = [];

  for (let i = 0; i < textChunks.length; i++) {
    const chunk = textChunks[i];
    console.log(`Translating chunk ${i + 1}/${textChunks.length}`);

    try {
      const response = await axios.post(
        BHASHINI_API_ENDPOINT,
        {
          pipelineTasks: [{
            taskType: "translation",
            config: {
              language: { sourceLanguage, targetLanguage },
            },
          }],
          inputData: {
            input: chunk.map((text) => ({ source: text })),
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: "zLA_jlURt70ufvlkYmhS5lYvGtgWOVwajrnygq_1dad5eszE2immUrUr8-hvysEe",
          },
          timeout: 30000
        }
      );

      const output = response.data.pipelineResponse[0].output;
      if (Array.isArray(output)) {
        translatedStrings.push(...output.map((item) => item.target || ""));
      } else {
        console.warn("Unexpected API response structure");
        translatedStrings.push(...chunk);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error("Translation error:", error.message);
      translatedStrings.push(...chunk);
    }
  }

  let translationIndex = 0;
  return textElements.map(element => {
    if (element.text && element.text.trim().length > 0) {
      return {
        ...element,
        originalText: element.text,
        text: translatedStrings[translationIndex++] || element.text,
      };
    }
    return element;
  });
}

function groupElementsByLine(elements, yTolerance = 5) {
  const lines = [];
  
  elements.forEach(element => {
    const line = lines.find(l => Math.abs(l.y - element.y) <= yTolerance);
    if (line) {
      line.elements.push(element);
    } else {
      lines.push({
        y: element.y,
        elements: [element],
        height: element.height
      });
    }
  });

  // Sort lines from top to bottom
  lines.sort((a, b) => a.y - b.y);
  
  // Sort elements in each line from left to right
  lines.forEach(line => {
    line.elements.sort((a, b) => a.x - b.x);
  });

  return lines;
}

function createTranslatedPDF(textElements, pdfDimensions, outputPath, targetLanguage) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [pdfDimensions.width, pdfDimensions.height],
      autoFirstPage: false,
      bufferPages: true
    });

    // Register fonts
    if (targetLanguage === 'en') {
      doc.registerFont('Regular', 'Helvetica');
      doc.registerFont('Bold', 'Helvetica-Bold');
    } else {
      doc.registerFont('DevanagariRegular', DEVANAGARI_FONT_PATH);
      doc.registerFont('DevanagariBold', DEVANAGARI_BOLD_PATH);
    }

    const outputStream = fs.createWriteStream(outputPath);
    outputStream.on('finish', () => resolve(true));
    outputStream.on('error', reject);

    doc.pipe(outputStream);

    // Group elements by line for proper vertical alignment
    const lines = groupElementsByLine(textElements);

    // Process each page
    for (let pageNum = 1; pageNum <= pdfDimensions.numPages; pageNum++) {
      doc.addPage({
        size: [pdfDimensions.width, pdfDimensions.height],
        margin: 0
      });

      const pageLines = lines.filter(line => 
        textElements.some(el => el.page === pageNum && Math.abs(el.y - line.y) <= 5)
      );

      // Draw each line
      pageLines.forEach(line => {
        // Draw each element in the line
        line.elements.forEach(element => {
          if (element.page !== pageNum) return;

          try {
            const fontName = targetLanguage === 'en' 
              ? (element.fontWeight === 'bold' ? 'Bold' : 'Regular')
              : (element.fontWeight === 'bold' ? 'DevanagariBold' : 'DevanagariRegular');

            const widthMultiplier = targetLanguage === 'en' ? 1 : 1.2;
            
            doc.font(fontName)
               .fontSize(element.fontSize)
               .text(element.text, element.x, element.y, {
                 width: element.width * widthMultiplier,
                 height: element.height,
                 align: 'left',
                 lineBreak: false
               });
          } catch (err) {
            console.warn(`Error rendering text:`, err.message);
          }
        });
      });
    }

    doc.end();
  });
}

async function translatePDFWithLayout(inputPdfPath, outputPdfPath, options = {}) {
  try {
    const { sourceLanguage , targetLanguage , apiKey } = options;

    // Only download fonts if needed
    if (targetLanguage !== 'en') {
      await ensureDevanagariFont();
    }

    // Extract content and metadata
    const [textElements, pdfDimensions] = await Promise.all([
      extractTextElementsFromPDF(inputPdfPath),
      getPDFDimensions(inputPdfPath)
    ]);

    // Translate the text
    const translatedElements = await batchTranslateTextElements(textElements, {
      sourceLanguage,
      targetLanguage,
      apiKey
    });

    // Generate the translated PDF
    await createTranslatedPDF(
      translatedElements,
      pdfDimensions,
      outputPdfPath,
      targetLanguage
    );

    return true;
  } catch (error) {
    console.error("PDF translation failed:", error);
    throw error;
  }
}

// function  for sendemail pdf

async function translatePDFWithLayoutEmail(inputPdfPath, outputPdfPath, options = {}) {
    try {
        const { sourceLanguage = 'en', targetLanguage="mr", apiKey } = options;

        // Only download fonts if needed
    // if (targetLanguage !== 'en') {
        //   await ensureDevanagariFont();
    // }

    // Extract content and metadata
    const [textElements, pdfDimensions] = await Promise.all([
      extractTextElementsFromPDF(inputPdfPath),
      getPDFDimensions(inputPdfPath)
    ]);

    // Translate the text
    const translatedElements = await batchTranslateTextElements(textElements, {
      sourceLanguage,
      targetLanguage,
      apiKey
    });

    // Generate the translated PDF
    await createTranslatedPDF(
      translatedElements,
      pdfDimensions,
      outputPdfPath,
      targetLanguage
    );

    return true;
  } catch (error) {
    console.error("PDF translation failed:", error);
    throw error;
  }
}

module.exports = {
  translatePDFWithLayout,
  translatePDFWithLayoutEmail,
  extractTextElementsFromPDF
};