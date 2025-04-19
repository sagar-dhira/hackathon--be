const sharp = require('sharp');
const axios = require('axios');
const { translatePDFWithLayout } = require('./pdfTranslateHelper');

async function translateImage(imageBuffer) {
    try {
        // Convert image to PDF
        const pdfBuffer = await sharp(imageBuffer)
            .toFormat('pdf')
            .toBuffer();

        // Create temporary files
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        const inputPdfPath = path.join(tempDir, `input_${Date.now()}.pdf`);
        const outputPdfPath = path.join(tempDir, `output_${Date.now()}.pdf`);

        // Save PDF temporarily
        fs.writeFileSync(inputPdfPath, pdfBuffer);

        // Translate PDF
        await translatePDFWithLayout(inputPdfPath, outputPdfPath);

        // Convert translated PDF back to image
        const translatedPdf = fs.readFileSync(outputPdfPath);
        const translatedImage = await sharp(translatedPdf)
            .toFormat('png')
            .toBuffer();

        // Clean up temporary files
        fs.unlinkSync(inputPdfPath);
        fs.unlinkSync(outputPdfPath);

        return translatedImage;
    } catch (error) {
        console.error('Error translating image:', error);
        throw error;
    }
}

module.exports = {
    translateImage
};
