import { retrieveContext } from './index.js';

async function testRetrieval() {
    try {
        console.log("Testing retrieval with 'French Revolution'...");
        const result = await retrieveContext('ask me question about french revolution');
        console.log('Retrieved context:', result);

        console.log("Testing retrieval with 'Math equation'...");
        const resultMath = await retrieveContext('solve linear equation');
        console.log('Retrieved math context:', resultMath);

        console.log("Testing retrieval with 'Biology'...");
        const resultBio = await retrieveContext('biology plants');
        console.log('Retrieved bio context:', resultBio);

    } catch (e) {
        console.error("Error invoking flow:", e);
    }
}

testRetrieval();
