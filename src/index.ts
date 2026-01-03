import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

import { googleAI } from '@genkit-ai/google-genai';
import { genkit, z } from 'genkit';

const ai = genkit({
    plugins: [
        googleAI(),
    ],
    model: googleAI.model('gemini-2.5-flash', {
        temperature: 0.8,
    }),
});

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
                `SELECT metadata FROM documents ORDER BY embedding <=> $1::vector LIMIT 5`,
                [embeddingVector]
            );

            return result.rows.map((row: any) => row.metadata.question);
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
                // Generate descriptive text using LLM
                const { text: description } = await ai.generate({
                    prompt: `Generate a detailed description for a question with the following metadata:
${JSON.stringify(q, null, 2)}

Instructions:
- The description should be natural language, suitable for semantic search embedding.
- Mention the difficulty, subject, class, board, year, topic, and marks.`,
                });

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

        const retrievedContext = await ai.run('retrieve-context', () => retrieveContext('ask me question aboout french revolution'));

        console.log('Retrieved context:', retrievedContext);

        return { indexedCount, errors };
    }
);
