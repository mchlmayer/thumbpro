import { GoogleGenAI, HarmCategory, HarmBlockThreshold, Modality } from "@google/genai";

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Utilitário para aguardar um tempo (em ms)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generates an image from a text prompt using the Imagen model.
 * Best for high-quality initial creations from text.
 */
export const generateImageWithText = async (
    prompt: string, 
    aspectRatio: string = '16:9'
): Promise<string> => {
  let attempts = 0;
  const maxAttempts = 3;

  while (true) {
    try {
      attempts++;
      console.log(`Generating image with prompt (Imagen) [Ratio: ${aspectRatio}] (Attempt ${attempts}):`, prompt);
      
      const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/png',
          aspectRatio: aspectRatio,
        },
      });

      if (!response.generatedImages || response.generatedImages.length === 0) {
        throw new Error("A API não retornou nenhuma imagem.");
      }

      const base64ImageBytes: string = response.generatedImages[0].image.imageBytes;
      
      if (!base64ImageBytes) {
          throw new Error("Os dados da imagem recebidos estão vazios.");
      }

      return base64ImageBytes;

    } catch (error) {
        const isQuotaError = error instanceof Error && (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED'));
        
        if (isQuotaError && attempts < maxAttempts) {
            // Backoff exponencial: 2s, 4s, 8s...
            const delay = Math.pow(2, attempts) * 1000 + 1000; 
            console.warn(`Quota hit (Imagen). Retrying in ${delay}ms...`);
            await wait(delay);
            continue;
        }

        console.error("Error calling Imagen API:", error);
        if (error instanceof Error) {
            if (isQuotaError) {
              throw new Error("Você atingiu o limite de requisições (quota) do Imagen. Por favor, aguarde um minuto e tente novamente.");
            }
            if (error.message.includes('400') && error.message.includes('safetySetting')) {
                throw new Error("Erro de configuração de segurança no modelo de imagem.");
            }
            throw new Error(`Falha ao gerar imagem: ${error.message}`);
        }
        throw new Error("Um erro inesperado ocorreu durante a geração da imagem.");
    }
  }
};


/**
 * Uses gemini-2.5-flash-image to edit/composite the reference image with the user prompt.
 * This preserves the original subject better than regenerating from text description.
 */
export const generateImageWithReference = async (
    prompt: string, 
    images: Array<{ data: string; mimeType: string }>,
    aspectRatio: string = '16:9'
): Promise<string> => {
    let attempts = 0;
    const maxAttempts = 3;

    while (true) {
        try {
            attempts++;
            console.log(`Editing reference with Gemini 2.5 Flash Image (Attempt ${attempts})...`);

            // Instructions to ensure the model uses the image as a base rather than just inspiration
            const editingPrompt = `
                Task: Create a high-quality YouTube Thumbnail based on the provided reference image.
                User Instructions: ${prompt}
                
                IMPORTANT: 
                - Preserve the main subject/person from the reference image. Do not replace them.
                - Integrate the user's requested elements (text, background, objects) around the subject.
                - High saturation, catchy YouTube style.
            `;

            const imageParts = images.map(image => ({
                inlineData: {
                    data: image.data,
                    mimeType: image.mimeType,
                },
            }));

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { 
                    parts: [ 
                        ...imageParts, 
                        { text: editingPrompt } 
                    ] 
                },
                config: {
                    responseModalities: [Modality.IMAGE],
                    safetySettings: [
                        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                    ],
                },
            });

            // Extract image from Gemini 2.5 Flash Image response structure
            let base64ImageBytes = '';
            
            if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
                for (const part of response.candidates[0].content.parts) {
                    if (part.inlineData && part.inlineData.data) {
                        base64ImageBytes = part.inlineData.data;
                        break;
                    }
                }
            }

            if (!base64ImageBytes) {
                 throw new Error("O modelo não retornou uma imagem válida.");
            }
            
            return base64ImageBytes;

        } catch (error) {
            const isQuotaError = error instanceof Error && (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED'));

            if (isQuotaError && attempts < maxAttempts) {
                const delay = Math.pow(2, attempts) * 1000 + 1000;
                console.warn(`Quota hit (Gemini Flash Image). Retrying in ${delay}ms...`);
                await wait(delay);
                continue;
            }

            console.error("Error calling Gemini API:", error);
            if (error instanceof Error) {
                if (isQuotaError) {
                    throw new Error("Você atingiu o limite de requisições (quota). Por favor, aguarde um minuto e tente novamente.");
                }
                throw new Error(`Falha ao gerar imagem com referência: ${error.message}`);
            }
            throw new Error("Um erro inesperado ocorreu durante o processamento da referência.");
        }
    }
};
