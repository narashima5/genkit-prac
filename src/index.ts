import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

// import { Document } from 'genkit/retriever';
// import { chunk } from 'llm-chunk';
// import { readFile } from 'fs/promises';
// import path from 'path';
// import { PDFParse } from 'pdf-parse';
import { googleAI } from '@genkit-ai/google-genai';
import { genkit, z, type EmbedderReference } from 'genkit';

const ai = genkit({
    plugins: [
        googleAI(),
    ],
    model: googleAI.model('gemini-2.5-flash', {
        temperature: 0.8,
    }),
});

// async function extractTextFromPdf(filePath: string) {
//     const pdfFile = path.resolve(filePath);
//     const dataBuffer = await readFile(pdfFile);
//     const parser = new PDFParse({ data: dataBuffer });
//     const data = await parser.getText();
//     return data.text;
// }

// export const menuPdfIndexer = { name: 'menuQA' } as any;

// const chunkingConfig = {
//     minLength: 1000,
//     maxLength: 2000,
//     splitter: 'sentence',
//     overlap: 100,
//     delimiters: '',
// } as any;

// export const indexMenu = ai.defineFlow(
//     {
//         name: 'indexMenu',
//         inputSchema: z.object({ filePath: z.string().describe('PDF file path') }),
//         outputSchema: z.object({
//             success: z.boolean(),
//             documentsIndexed: z.number(),
//             error: z.string().optional(),
//         }),
//     },
//     async ({ filePath }) => {
//         try {
//             filePath = path.resolve(filePath);

//             // Read the pdf
//             const pdfTxt = await ai.run('extract-text', () => extractTextFromPdf(filePath));

//             // Divide the pdf text into segments
//             const chunks = await ai.run('chunk-it', async () => chunk(pdfTxt, chunkingConfig));

//             // Convert chunks of text into documents to store in the index.
//             const documents = chunks.map((text: string) => {
//                 return Document.fromText(text, { filePath });
//             });

//             // Add documents to the index
//             await ai.index({
//                 indexer: menuPdfIndexer,
//                 documents,
//             });

//             return {
//                 success: true,
//                 documentsIndexed: documents.length,
//             };
//         } catch (err) {
//             // For unexpected errors that throw exceptions
//             return {
//                 success: false,
//                 documentsIndexed: 0,
//                 error: err instanceof Error ? err.message : String(err),
//             };
//         }
//     },
// );

const pool = new Pool({
    user: 'postgres',
    password: 'postgrespassword',
    host: 'localhost',
    port: 5433,
    database: 'qp-generator-db',
});

async function initDB() {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');

    await pool.query(`CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        content TEXT,
        metadata JSONB,
        embedding vector(3072)
    )`);
}

export const embedAndStore = ai.defineFlow(
    {
        name: 'embedAndStore',
        inputSchema: z.object({
            text: z.string(),
            metadata: z.record(z.any()).optional(),
        }),
        outputSchema: z.boolean(),
    },
    async ({ text, metadata }) => {
        try {
            await initDB();
            const embedding = await ai.embed({
                embedder: googleAI.embedder('gemini-embedding-001'),
                content: text,
            });
            console.log('Embedding output:', JSON.stringify(embedding));
            const firstEmbedding = embedding[0]?.embedding;
            console.log('First embedding:', JSON.stringify(firstEmbedding));

            if (!firstEmbedding) throw new Error('No embedding returned');

            const embeddingVector = JSON.stringify(firstEmbedding);
            console.log('Vector string:', embeddingVector);



            await pool.query(
                'INSERT INTO documents (content, metadata, embedding) VALUES ($1, $2, $3::vector)',
                [text, metadata || {}, embeddingVector]
            );
            return true;
        } catch (error) {
            console.error('Error storing embedding:', error);
            throw error;
        }
    }
);

export const retrieveContext = ai.defineFlow(
    {
        name: 'retrieveContext',
        inputSchema: z.string(),
        outputSchema: z.array(z.string()),
    },
    async (query) => {
        try {
            const embedding = await ai.embed({
                embedder: googleAI.embedder('gemini-embedding-001'),
                content: query,
            });
            const firstEmbedding = embedding[0]?.embedding;
            if (!firstEmbedding) throw new Error('No embedding returned for query');
            const embeddingVector = JSON.stringify(firstEmbedding);

            const result = await pool.query(
                `SELECT content FROM documents ORDER BY embedding <=> $1::vector LIMIT 5`,
                [embeddingVector]
            );

            return result.rows.map((row: any) => row.content);
        } catch (error) {
            console.error('Error retrieving context:', error);
            throw error;
        }
    }
);






const QuestionSchema = z.object({
    question: z.string(),
    subject: z.string(),
    class: z.number(),
    year: z.number(),
    topic: z.string(),
    mark: z.number(),
    difficultyLevel: z.string(),
    board: z.string(),
    isMcq: z.boolean(),
    options: z.array(z.string()).nullable(),
    containsImages: z.boolean(),
    imageDescription: z.string().nullable(),
    isEitherOr: z.boolean(),
    otherQuestion: z.string().nullable(),
    isRepeated: z.boolean(),
});

export const indexQuestions = ai.defineFlow(
    {
        name: 'indexQuestions',
        inputSchema: z.array(QuestionSchema),
        outputSchema: z.object({
            indexedCount: z.number(),
            errors: z.array(z.string()),
        }),
    },
    async (questions) => {
        let indexedCount = 0;
        const errors: string[] = [];

        await initDB();

        for (const q of questions) {
            try {
                // Generate descriptive text for embedding and content
                let description = `Question: "${q.question}"\n`;
                description += `This is a ${q.difficultyLevel} level ${q.subject} question for Class ${q.class} (${q.board} Board), from the year ${q.year}. `;
                description += `It covers the topic "${q.topic}" and is worth ${q.mark} mark(s). `;

                if (q.isMcq && q.options) {
                    description += `It is a Multiple Choice Question with options: ${q.options.join(', ')}. `;
                } else {
                    description += `It is a descriptive question. `;
                }

                if (q.containsImages && q.imageDescription) {
                    description += `It includes an image described as: "${q.imageDescription}". `;
                }

                if (q.isRepeated) {
                    description += `This question has appeared in previous exams.`;
                }

                const embedding = await ai.embed({
                    embedder: googleAI.embedder('gemini-embedding-001'),
                    content: description,
                });

                const firstEmbedding = embedding[0]?.embedding;
                if (!firstEmbedding) throw new Error('No embedding returned');

                const embeddingVector = JSON.stringify(firstEmbedding);

                await pool.query(
                    'INSERT INTO documents (content, metadata, embedding) VALUES ($1, $2, $3::vector)',
                    [description, q, embeddingVector]
                );
                indexedCount++;
            } catch (error) {
                console.error(`Error indexing question "${q.question}":`, error);
                errors.push(`Failed to index "${q.question}": ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        return { indexedCount, errors };
    }
);
