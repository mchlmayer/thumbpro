import { GoogleGenAI, Modality } from "@google/genai";

/**
 * Generates an image using Imagen 4.0 (primary) or Gemini 2.5 Flash (fallback).
 * Removes retry loops to give immediate feedback.
 */
export const generateImageWithText = async (
    prompt: string, 
    aspectRatio: string = '16:9'
): Promise<string> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
  }
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Tenta primeiro o modelo Imagen 4.0 (Maior qualidade, cota diferente)
  try {
      const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          // Cast as any because the string values from app match the API requirements perfectly
          aspectRatio: aspectRatio as any, 
        },
      });

      const base64 = response.generatedImages?.[0]?.image?.imageBytes;
      if (!base64) throw new Error("Imagen 4.0 não retornou dados.");
      
      return base64;

  } catch (imagenError: any) {
     console.warn("Imagen 4.0 indisponível, tentando fallback para Flash...", imagenError);
     
     // Fallback: Tenta o Gemini 2.5 Flash Image uma única vez
     try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
              parts: [
                {
                  text: `Create a high quality YouTube Thumbnail. Aspect Ratio: ${aspectRatio}. Description: ${prompt}. Vivid colors, 4k resolution.`,
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
            throw new Error("Dados de imagem vazios no fallback.");
        }

        return base64ImageBytes;

     } catch (flashError: any) {
        // Se ambos falharem, retorna erro direto para o usuário
        if (flashError.message?.includes('429') || flashError.message?.includes('quota') || flashError.message?.includes('RESOURCE_EXHAUSTED')) {
            throw new Error("Cota excedida temporariamente. O Google limitou as gerações gratuitas neste momento.");
        }
        if (flashError.message?.includes('safety') || flashError.message?.includes('blocked')) {
            throw new Error("A imagem foi bloqueada pelos filtros de segurança.");
        }
        throw new Error("Não foi possível gerar a imagem com nenhum dos modelos disponíveis.");
     }
  }
};


/**
 * Uses gemini-2.5-flash-image to edit/composite the reference image.
 * Reference editing is only supported well on Flash models currently.
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

    try {
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

    } catch (error: any) {
        console.error("Reference generation error:", error);
        if (error.message?.includes('429') || error.message?.includes('quota')) {
            throw new Error("Muitas requisições. Tente novamente em 1 minuto.");
        }
        if (error.message?.includes('safety') || error.message?.includes('blocked')) {
                throw new Error("Conteúdo bloqueado pela segurança.");
        }
        throw new Error(`Falha ao gerar: ${error.message}`);
    }
};
