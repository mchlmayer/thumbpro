import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Generates an image from a text prompt using the Imagen model.
 * Best for high-quality initial creations from text.
 */
export const generateImageWithText = async (
    prompt: string, 
    aspectRatio: string = '16:9'
): Promise<string> => {
  try {
    console.log(`Generating image with prompt (Imagen) [Ratio: ${aspectRatio}]:`, prompt);
    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: prompt,
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/png',
        aspectRatio: aspectRatio,
        safetyFilterLevel: 'block_only_high',
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
    console.error("Error calling Imagen API:", error);
    if (error instanceof Error) {
        if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED')) {
          throw new Error("Você atingiu o limite de requisições (quota). Por favor, aguarde um minuto e tente novamente.");
        }
        throw new Error(`Falha ao gerar imagem: ${error.message}`);
    }
    throw new Error("Um erro inesperado ocorreu durante a geração da imagem.");
  }
};


/**
 * Generates or edits an image based on a text prompt and reference images using the Gemini Flash Image model.
 * Best for editing an existing image or creating a new one based on references.
 */
export const generateImageWithReference = async (
    prompt: string, 
    images: Array<{ data: string; mimeType: string }>,
    aspectRatio: string = '16:9'
): Promise<string> => {
    try {
        // Prompt focused on strict identity preservation without complex sliders
        const enhancedPrompt = `
STRICT INSTRUCTION: DO NOT ALTER THE FACIAL EXPRESSION OR FEATURES OF THE PERSON IN THE REFERENCE IMAGE.
The user wants to create a YouTube thumbnail based on the reference image provided.

User Prompt: "${prompt}"

GUIDELINES:
1. **NO SMILES/EMOTION CHANGE:** The face and expression of the subject in the reference image must remain UNCHANGED. Do NOT force a smile unless explicitly requested in the prompt.
2. **PRESERVE IDENTITY:** The person in the output must look exactly like the person in the reference image.
3. **INTEGRATION:** Only modify the background, add text, or add objects as requested by the user.
4. **QUALITY:** Maintain the lighting and photo-realistic quality of the original subject.

Output Aspect Ratio: ${aspectRatio}
`;

        console.log(`Generating/editing image with reference(s) (Gemini Flash Image) [Ratio: ${aspectRatio}]:`, enhancedPrompt);

        const imageParts = images.map(image => ({
            inlineData: {
                data: image.data,
                mimeType: image.mimeType,
            },
        }));

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [ ...imageParts, { text: enhancedPrompt } ] },
            config: {
                responseModalities: [Modality.IMAGE],
                // Permissive safety settings
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                ],
            },
        });

        const candidate = response.candidates?.[0];

        if (!candidate || !candidate.content || !candidate.content.parts) {
             if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
                let errorMsg = `A geração da imagem foi interrompida. Motivo: ${candidate.finishReason}`;
                if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'NO_IMAGE' || candidate.finishReason === 'BLOCK') {
                    errorMsg += ". O modelo bloqueou o conteúdo por motivos de segurança. Tente reformular o prompt para ser mais descritivo e seguro.";
                }
                throw new Error(errorMsg);
             }
             throw new Error("A resposta da API não continha o conteúdo esperado ou foi bloqueada.");
        }

        for (const part of candidate.content.parts) {
            if (part.inlineData && part.inlineData.mimeType.startsWith('image/')) {
                return part.inlineData.data;
            }
        }

        throw new Error("A API não retornou uma imagem no formato esperado.");

    } catch (error) {
        console.error("Error calling Gemini Flash Image API:", error);
        if (error instanceof Error) {
            if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED')) {
                throw new Error("Você atingiu o limite de requisições (quota). Por favor, aguarde um minuto e tente novamente.");
            }
            if (error.message.startsWith("A geração da imagem")) {
                throw error;
            }
            throw new Error(`Falha ao gerar/editar imagem com referência: ${error.message}`);
        }
        throw new Error("Um erro inesperado ocorreu durante a geração/edição da imagem.");
    }
};