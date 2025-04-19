const axios = require('axios');

const BHASHINI_API_URL = 'https://dhruva-api.bhashini.gov.in/services/inference/pipeline';
const BHASHINI_API_KEY = 'zLA_jlURt70ufvlkYmhS5lYvGtgWOVwajrnygq_1dad5eszE2immUrUr8-hvysEe';

// async function convertTextToSpeech(options) {
//     console.log('OPTIONS:', options); // <-- debug line
// console.log('TEXT:', options.text); // <-- debug line
//     try {
//         const {
//             text,
//             sourceLanguage,
//             targetLanguage = 'en',
//             nmtServiceId = 'bhashini/ai4bharat/indic-ner',
//             ttsServiceId = 'Bhashini/IITM/TTS',
//             gender = 'male',
//             samplingRate = 8000
//         } = options;

//         if (!text) {
//             throw new Error('Text is required');
//         }
//         if (!sourceLanguage) {
//             throw new Error('Source language is required');
//         }

//         const response = await axios.post(BHASHINI_API_URL, {
//             "pipelineTasks": [
//                 {
//                     "taskType": "translation",
//                     "config": {
//                         "language": {
//                             "sourceLanguage": sourceLanguage,
//                             "targetLanguage": targetLanguage
//                         },
//                         "serviceId": nmtServiceId
//                     }
//                 },
//                 {
//                     "taskType": "tts",
//                     "config": {
//                         "language": {
//                             "sourceLanguage": targetLanguage
//                         },
//                         "serviceId": ttsServiceId,
//                         "gender": gender,
//                         "samplingRate": samplingRate
//                     }
//                 }
//             ],
//             "inputData": {
//                 "input": [
//                     {
//                         "source": text
//                     }
//                 ]
//             }
//         }, {
//             headers: {
//                 'Authorization': `Bearer ${BHASHINI_API_KEY}`,
//                 'Content-Type': 'application/json'
//             }
//         });

//         return response.data;
//     } catch (error) {
//         console.error('Error in TTS conversion:', error);
//         throw error;
//     }
// }

async function convertTextToSpeech(options) {
    try {
        // ✅ If you're passing full payload (custom format), skip validation
        if (options.pipelineTasks && options.inputData) {
            const response = await axios.post(BHASHINI_API_URL, options, {
                headers: {
                    'Authorization': `${BHASHINI_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        }

        // 👇 Default fallback for simplified usage
        const {
            text,
            sourceLanguage,
            targetLanguage = 'en',
            nmtServiceId = 'bhashini/ai4bharat/indic-ner',
            ttsServiceId = 'Bhashini/IITM/TTS',
            gender = 'male',
            samplingRate = 8000
        } = options;

        if (!text) throw new Error('Text is required');
        if (!sourceLanguage) throw new Error('Source language is required');

        const payload = {
            pipelineTasks: [
                {
                    taskType: "translation",
                    config: {
                        language: {
                            sourceLanguage,
                            targetLanguage
                        },
                        serviceId: nmtServiceId
                    }
                },
                {
                    taskType: "tts",
                    config: {
                        language: {
                            sourceLanguage: targetLanguage
                        },
                        serviceId: ttsServiceId,
                        gender,
                        samplingRate
                    }
                }
            ],
            inputData: {
                input: [
                    { source: text }
                ]
            }
        };

        const response = await axios.post(BHASHINI_API_URL, payload, {
            headers: {
                'Authorization': `${BHASHINI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data;

    } catch (error) {
        console.error('Error in TTS conversion:', error.message || error);
        throw error;
    }
}


module.exports = {
    convertTextToSpeech
};
