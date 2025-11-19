import { GoogleGenAI, Modality } from "@google/genai";

// Utilitário para aguardar um tempo (em ms)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generates an image using Gemini 2.5 Flash Image.
 * Optimized for free tier with exponential backoff.
 */
export const generateImageWithText = async (
    prompt: string, 
    aspectRatio: string = '16:9'
): Promise<string> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
  }
  
  // Initialize client per request to ensure freshness
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  let attempts = 0;
  const maxAttempts = 5;

  // Prompt otimizado para o modelo Flash
  const enhancedPrompt = `Create a high quality YouTube Thumbnail. Aspect Ratio: ${aspectRatio}. Description: ${prompt}. Vivid colors, 4k resolution.`;

  while (true) {
    try {
      attempts++;
      
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
        },
      });

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
          throw new Error("Os dados da imagem recebidos estão vazios.");
      }

      return base64ImageBytes;

    } catch (error) {
        const isQuotaError = error instanceof Error && (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('quota'));
        
        if (isQuotaError && attempts < maxAttempts) {
            // Backoff Exponencial: 2s, 4s, 8s, 10s, 10s...
            // Isso permite cobrir janelas de tempo maiores onde o limite gratuito reseta.
            const backoff = Math.min(10000, Math.pow(2, attempts) * 1000);
            const delay = backoff + (Math.random() * 1000); // Jitter
            
            console.warn(`Quota hit (Attempt ${attempts}). Retrying in ${Math.round(delay)}ms...`);
            await wait(delay);
            continue;
        }

        console.error("Error calling Gemini API:", error);
        if (error instanceof Error) {
            if (isQuotaError) {
              throw new Error("Muitos acessos recentes. O limite gratuito foi atingido momentaneamente. Aguarde 1 minuto e tente novamente.");
            }
            if (error.message.includes('safetySetting') || error.message.includes('blocked')) {
                throw new Error("A imagem não pôde ser gerada devido aos filtros de segurança do Google. Tente mudar a descrição.");
            }
            throw new Error(`Falha ao gerar imagem: ${error.message}`);
        }
        throw new Error("Um erro inesperado ocorreu.");
    }
  }
};


/**
 * Uses gemini-2.5-flash-image to edit/composite the reference image.
 */
export const generateImageWithReference = async (
    prompt: string, 
    images: Array<{ data: string; mimeType: string }>,
    aspectRatio: string = '16:9'
): Promise<string> => {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable not set");
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    let attempts = 0;
    const maxAttempts = 5;

    while (true) {
        try {
            attempts++;
            
            const editingPrompt = `
                Create a YouTube Thumbnail.
                Reference Image provided.
                User Instructions: ${prompt}
                Output Aspect Ratio: ${aspectRatio}
                Style: High quality, vivid, clickbait style.
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
                },
            });

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
                const backoff = Math.min(10000, Math.pow(2, attempts) * 1000);
                const delay = backoff + (Math.random() * 1000);
                console.warn(`Quota hit (Ref Attempt ${attempts}). Retrying in ${Math.round(delay)}ms...`);
                await wait(delay);
                continue;
            }

            console.error("Error calling Gemini API:", error);
            if (error instanceof Error) {
                if (isQuotaError) {
                    throw new Error("Limite de tráfego atingido. Tente novamente em 1 minuto.");
                }
                if (error.message.includes('safetySetting') || error.message.includes('blocked')) {
                     throw new Error("Conteúdo bloqueado pelos filtros de segurança. Tente suavizar a descrição.");
                }
                throw new Error(`Falha ao gerar imagem com referência: ${error.message}`);
            }
            throw new Error("Erro inesperado ao processar referência.");
        }
    }
};
