
import express from 'express';
import cors from 'cors';
import { indexQuestions, retrieveContext } from './index.js';

const app = express();
const port = 3400;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.post('/indexQuestions', async (req, res) => {
    try {
        // Support { data: [...] } or direct [...]
        const input = req.body.data || req.body;
        console.log(`Received indexQuestions request with ${Array.isArray(input) ? input.length : 0} items`);
        const result = await indexQuestions(input);
        res.json(result);
    } catch (error) {
        console.error('Error in indexQuestions:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

app.post('/retrieveContext', async (req, res) => {
    try {
        console.log('Received retrieveContext request body:', JSON.stringify(req.body, null, 2));
        // Flexibility for input format
        const body = req.body;
        let query: string;

        if (typeof body.data === 'string') {
            query = body.data;
        } else if (typeof body.query === 'string') {
            query = body.query;
        } else if (typeof body.text === 'string') {
            query = body.text;
        } else if (typeof body === 'string') {
            query = body;
        } else {
            // Try to handle nested data wrapper for object?
            const data = body.data || body;
            if (typeof data === 'string') query = data;
            else if (typeof data.query === 'string') query = data.query;
            else if (typeof data.text === 'string') query = data.text;
            else {
                return res.status(400).json({ error: "Could not determine query string from body. pass {data: 'query'} or {query: 'query'}" });
            }
        }

        console.log(`Extracted query: "${query}"`);

        const result = await retrieveContext(query);
        res.json(result);
    } catch (error) {
        console.error('Error in retrieveContext:', error);
        if (error instanceof Error) {
            console.error('Stack:', error.stack);
        }
        res.status(500).json({
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
    }
});

app.listen(port, () => {
    console.log(`Flow server running on http://localhost:${port}`);
    console.log(`Endpoints:`);
    console.log(`  POST http://localhost:${port}/indexQuestions`);
    console.log(`  POST http://localhost:${port}/retrieveContext`);
});
