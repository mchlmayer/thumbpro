import { GoogleGenAI, Modality } from "@google/genai";

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Utilitário para aguardar um tempo (em ms)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generates an image using Gemini 2.5 Flash Image.
 * Switched from Imagen to Flash Image to reduce 'Resource Exhausted' errors and improve availability.
 */
export const generateImageWithText = async (
    prompt: string, 
    aspectRatio: string = '16:9'
): Promise<string> => {
  let attempts = 0;
  // Aumentado para 10 tentativas para garantir que passe por janelas de 1 minuto de cota
  const maxAttempts = 10;

  // Append aspect ratio instruction to the prompt since Flash Image handles it via text better than config sometimes
  const enhancedPrompt = `${prompt}. The image should be in ${aspectRatio} aspect ratio. High quality YouTube Thumbnail, vivid colors.`;

  while (true) {
    try {
      attempts++;
      console.log(`Generating image with Gemini 2.5 Flash Image [Ratio: ${aspectRatio}] (Attempt ${attempts}):`, prompt);
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: enhancedPrompt,
            },
          ],
        },
        config: {
            responseModalities: [Modality.IMAGE], 
            // Note: aspectRatio config is not strictly supported in generateContent for Flash Image the same way as generateImages, 
            // so we rely on the prompt injection above.
        },
      });

      let base64ImageBytes = '';
      
      // Extract image from Gemini 2.5 Flash Image response structure
      if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
          for (const part of response.candidates[0].content.parts) {
              if (part.inlineData && part.inlineData.data) {
                  base64ImageBytes = part.inlineData.data;
                  break;
              }
          }
      }

      if (!base64ImageBytes) {
          throw new Error("Os dados da imagem recebidos estão vazios.");
      }

      return base64ImageBytes;

    } catch (error) {
        const isQuotaError = error instanceof Error && (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('quota'));
        
        if (isQuotaError && attempts < maxAttempts) {
            // Estratégia muito agressiva para limites de 1 minuto.
            // Espera progressiva: 15s, 30s, 45s...
            // Isso garante que superaremos o limite de "requests per minute".
            const delay = 15000 * attempts; 
            console.warn(`Quota hit (Gemini Flash Image). Retrying in ${delay}ms...`);
            await wait(delay);
            continue;
        }

        console.error("Error calling Gemini API:", error);
        if (error instanceof Error) {
            if (isQuotaError) {
              throw new Error("O sistema está com tráfego extremamente alto. Tente novamente em alguns minutos.");
            }
            if (error.message.includes('safetySetting')) {
                throw new Error("Erro de configuração de segurança no modelo.");
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
    // Aumentado para 10 tentativas para garantir robustez contra erros de cota
    const maxAttempts = 10;

    while (true) {
        try {
            attempts++;
            console.log(`Editing reference with Gemini 2.5 Flash Image (Attempt ${attempts})...`);

            // Instructions to ensure the model uses the image as a base rather than just inspiration
            // Keeping it generic as requested, preserving the subject and style.
            const editingPrompt = `
                Task: Create a high-quality YouTube Thumbnail based on the provided reference image.
                User Instructions: ${prompt}
                Target Aspect Ratio: ${aspectRatio}
                
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
                    // Removed safetySettings to fix 400 error ("Only block_low_and_above is supported")
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
            const isQuotaError = error instanceof Error && (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('quota'));

            if (isQuotaError && attempts < maxAttempts) {
                // Estratégia muito agressiva para limites de 1 minuto.
                // Espera progressiva: 15s, 30s, 45s...
                const delay = 15000 * attempts;
                console.warn(`Quota hit (Gemini Flash Image Ref). Retrying in ${delay}ms...`);
                await wait(delay);
                continue;
            }

            console.error("Error calling Gemini API:", error);
            if (error instanceof Error) {
                if (isQuotaError) {
                    throw new Error("Muitas solicitações recentes. Aguarde um momento antes de tentar novamente.");
                }
                if (error.message.includes('safetySetting')) {
                     throw new Error("Erro de configuração da API (Safety Settings). Tente novamente.");
                }
                throw new Error(`Falha ao gerar imagem com referência: ${error.message}`);
            }
            throw new Error("Um erro inesperado ocorreu durante o processamento da referência.");
        }
    }
};
