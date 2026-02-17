#!/usr/bin/env node

/**
 * Standalone API Server Runner (Simplified)
 * 
 * This script runs the Claude Autopilot API server independently from the VS Code extension
 * for testing and development purposes.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8000;

// Simple logger
const logger = {
    info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args)
};

// Load system prompt
let systemPrompt = '';
try {
    systemPrompt = fs.readFileSync('/Users/benbasha/Development/ben/calude-code-loop/system_prompt.txt', 'utf8').trim();
} catch (error) {
    logger.warn('Could not load system prompt:', error.message);
}

// Real Claude CLI utility
const executeClaudeCommand = async (messages, useClaudeLoop = false) => {
    return new Promise((resolve, reject) => {
        const args = ['-p'];
        
        // Only use JSON format for claudeloop-local model
        if (useClaudeLoop) {
            args.push('--input-format', 'stream-json');
            args.push('--output-format', 'stream-json');
            args.push('--verbose');
        }
        
        const claude = spawn('claude', args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true
        });

        let output = '';
        let errorOutput = '';

        // Prepare messages array with system prompt if needed
        let messagesToSend = [...messages];
        
        // Add system prompt as first message for claudeloop-local if not already present
        if (useClaudeLoop && systemPrompt) {
            const hasSystemMessage = messagesToSend.some(msg => msg.role === 'system');
            if (!hasSystemMessage) {
                messagesToSend.unshift({
                    role: 'user',
                    content: systemPrompt
                });
            }
        }

        // Send the message to Claude's stdin with error handling
        try {
            if (useClaudeLoop) {
                // For JSON format, flatten all content from all messages into a single content array
                const allContent = [];
                for (const msg of messagesToSend) {
                    if (Array.isArray(msg.content)) {
                        allContent.push(...msg.content);
                    } else {
                        allContent.push({
                            type: 'text',
                            text: msg.content
                        });
                    }
                }
                
                const jsonMessage = JSON.stringify({
                    type: 'user',
                    message: {
                        role: 'user',
                        content: allContent.map(x => x.text).join("\n\n-----------\n\n")
                    }
                }) + '\n';
                
                if (!claude.stdin.destroyed) {
                    claude.stdin.write(jsonMessage);
                }
            } else {
                // For non-JSON format, concatenate all messages with role context
                let finalMessage = '';
                
                // Add system prompt if it exists in messages or from systemPrompt variable
                const systemMessage = messagesToSend.find(m => m.role === 'system');
                if (systemMessage) {
                    const systemContent = Array.isArray(systemMessage.content) 
                        ? systemMessage.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
                        : systemMessage.content;
                    finalMessage += systemContent + '\n\n';
                } else if (systemPrompt) {
                    finalMessage += systemPrompt + '\n\n';
                }
                
                // Add conversation history
                for (const msg of messagesToSend) {
                    if (msg.role !== 'system') {
                        const content = Array.isArray(msg.content) 
                            ? msg.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
                            : msg.content;
                        finalMessage += `${msg.role}: ${content}\n\n`;
                    }
                }
                
                if (!claude.stdin.destroyed) {
                    claude.stdin.write(finalMessage);
                }
            }
            if (!claude.stdin.destroyed) {
                claude.stdin.end();
            }
        } catch (writeError) {
            logger.error('Error writing to Claude CLI stdin:', writeError);
            reject(new Error(`Failed to write to Claude CLI: ${writeError.message}`));
            return;
        }

        // Handle stdin errors
        claude.stdin.on('error', (stdinError) => {
            if (stdinError.code !== 'EPIPE') {
                logger.error('Claude CLI stdin error:', stdinError);
            }
        });

        // Collect stdout
        claude.stdout.on('data', (data) => {
            output += data.toString();
        });

        // Collect stderr
        claude.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        // Handle process completion
        claude.on('close', (code) => {
            if (code === 0) {
                // For JSON output, parse the Claude streaming response into structured format
                if (useClaudeLoop && output.trim()) {
                    try {
                        const lines = output.trim().split('\n');
                        const parsedResponse = {
                            messages: [],
                            finalResult: '',
                            toolCalls: []
                        };
                        
                        // Parse all assistant messages and tool calls from the JSON stream
                        for (const line of lines) {
                            if (line.trim()) {
                                try {
                                    const parsed = JSON.parse(line);
                                    
                                    if (parsed.type === 'assistant' && parsed.message) {
                                        // Extract text content and tool calls
                                        const content = parsed.message.content || [];
                                        
                                        for (const item of content) {
                                            if (item.type === 'text' && item.text) {
                                                parsedResponse.messages.push({
                                                    role: 'assistant',
                                                    content: item.text
                                                });
                                            } else if (item.type === 'tool_use') {
                                                parsedResponse.toolCalls.push({
                                                    id: item.id,
                                                    type: 'function',
                                                    function: {
                                                        name: item.name,
                                                        arguments: JSON.stringify(item.input || {})
                                                    }
                                                });
                                            }
                                        }
                                    } else if (parsed.type === 'result' && parsed.result) {
                                        parsedResponse.finalResult = parsed.result;
                                    }
                                } catch (lineParseError) {
                                    logger.warn('Failed to parse JSON line:', line.substring(0, 50));
                                }
                            }
                        }
                        
                        resolve(parsedResponse);
                    } catch (parseError) {
                        // Fallback to raw output if JSON parsing fails
                        logger.warn('Failed to parse JSON output, using raw output:', parseError.message);
                        resolve(output.trim());
                    }
                } else {
                    resolve(output.trim());
                }
            } else {
                logger.error(`Claude CLI exited with code ${code}:`, errorOutput);
                reject(new Error(`Claude CLI failed with code ${code}: ${errorOutput}`));
            }
        });

        // Handle process errors
        claude.on('error', (error) => {
            logger.error('Claude CLI process error:', error);
            reject(new Error(`Claude CLI process error: ${error.message}`));
        });
    });
};

// Create Express app
const app = express();

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    credentials: false
}));

app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    logger.info(`[${requestId}] ${req.method} ${req.path}`);
    logger.info(`[${requestId}] Origin: ${req.headers.origin || 'none'}`);
    
    res.setHeader('X-Request-ID', requestId);
    next();
});

// Simple auth middleware (accept any API key)
app.use('/v1', (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: {
                message: 'Invalid API key provided',
                type: 'invalid_request_error',
                param: null,
                code: 'invalid_api_key'
            }
        });
    }
    next();
});

// Routes
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        server: 'Claude Autopilot Standalone API'
    });
});

app.get('/v1/models', (req, res) => {
    res.json({
        object: 'list',
        data: [
            {
                id: 'claudeloop-local',
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: 'claudeloop',
                permission: [],
                root: 'claudeloop-local',
                parent: null
            },
            {
                id: 'claude-3-5-sonnet-20241022',
                object: 'model', 
                created: Math.floor(Date.now() / 1000),
                owned_by: 'anthropic',
                permission: [],
                root: 'claude-3-5-sonnet-20241022',
                parent: null
            },
            // OpenAI-compatible model names (all map to claudeloop-local)
            {
                id: 'gpt-4',
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: 'claudeloop',
                permission: [],
                root: 'gpt-4',
                parent: null
            },
            {
                id: 'gpt-4o',
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: 'claudeloop',
                permission: [],
                root: 'gpt-4o',
                parent: null
            },
            {
                id: 'gpt-3.5-turbo',
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: 'claudeloop',
                permission: [],
                root: 'gpt-3.5-turbo',
                parent: null
            }
        ]
    });
});

app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { model, messages, stream = false, max_tokens = 4096, temperature = 1.0 } = req.body;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                error: {
                    message: 'Messages are required',
                    type: 'invalid_request_error',
                    param: 'messages',
                    code: null
                }
            });
        }

        // Get the last user message
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role !== 'user') {
            return res.status(400).json({
                error: {
                    message: 'Last message must be from user',
                    type: 'invalid_request_error',
                    param: 'messages',
                    code: null
                }
            });
        }

        // Check if using claudeloop-local model
        const useClaudeLoop = model === 'claudeloop-local';

        logger.info('Processing chat completion:', {
            model,
            messageCount: messages.length,
            useClaudeLoop,
            lastUserMessage: typeof lastMessage.content === 'string' 
                ? lastMessage.content.substring(0, 100) + '...'
                : (Array.isArray(lastMessage.content) 
                    ? lastMessage.content.filter(item => item.type === 'text').map(item => item.text).join(' ').substring(0, 100) + '...'
                    : '...')
        });

        if (stream) {
            // Streaming response
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Transfer-Encoding', 'chunked');

            const response = await executeClaudeCommand(messages, useClaudeLoop);
            
            // Handle structured response for streaming
            let finalText = '';
            if (useClaudeLoop && typeof response === 'object' && response.finalResult) {
                finalText = response.finalResult;
            } else {
                finalText = typeof response === 'string' ? response : String(response);
            }
            
            const words = finalText.split(' ');
            
            for (let i = 0; i < words.length; i++) {
                const chunk = {
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: model || 'claude-3-5-sonnet-20241022',
                    choices: [{
                        index: 0,
                        delta: {
                            content: words[i] + (i < words.length - 1 ? ' ' : '')
                        },
                        finish_reason: i === words.length - 1 ? 'stop' : null
                    }]
                };
                
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                await new Promise(resolve => setTimeout(resolve, 50)); // Small delay between words
            }
            
            res.write('data: [DONE]\n\n');
            res.end();
        } else {
            // Non-streaming response
            const response = await executeClaudeCommand(messages, useClaudeLoop);
            
            // Handle structured response from Claude loop or simple text response
            let choices = [];
            let responseContent = '';
            
            if (useClaudeLoop && typeof response === 'object' && response.messages) {
                // Create choices for each message and tool calls
                let choiceIndex = 0;
                
                // Add text messages
                for (const msg of response.messages) {
                    choices.push({
                        index: choiceIndex++,
                        message: {
                            role: msg.role,
                            content: msg.content
                        },
                        finish_reason: 'stop'
                    });
                }
                
                // Add tool calls as a separate choice if any exist
                if (response.toolCalls && response.toolCalls.length > 0) {
                    choices.push({
                        index: choiceIndex++,
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: response.toolCalls
                        },
                        finish_reason: 'tool_calls'
                    });
                }
                
                // Use final result as the main content
                responseContent = response.finalResult || (response.messages.length > 0 ? response.messages[response.messages.length - 1].content : 'No response');
            } else {
                // Simple text response
                responseContent = typeof response === 'string' ? response : String(response);
                choices = [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: responseContent
                    },
                    finish_reason: 'stop'
                }];
            }
            
            const completion = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: model || 'claude-3-5-sonnet-20241022',
                choices: choices,
                usage: {
                                    
                    "prompt_tokens": 28,
                    "completion_tokens": 10,
                    "total_tokens": 38,
                    "prompt_tokens_details": {
                        "cached_tokens": 0,
                        "audio_tokens": 0
                    },
                    "completion_tokens_details": {
                        "reasoning_tokens": 0,
                        "audio_tokens": 0,
                        "accepted_prediction_tokens": 0,
                        "rejected_prediction_tokens": 0
                    }
                },
                "service_tier": "default",
                "system_fingerprint": "fp_a288987b44"
            };

            res.json(completion);
        }

    } catch (error) {
        logger.error('Chat completion error:', error);
        res.status(500).json({
            error: {
                message: 'Internal server error',
                type: 'server_error',
                code: 'internal_error'
            }
        });
    }
});

// Error handling
app.use((err, req, res, next) => {
    logger.error('API Error:', err);
    res.status(500).json({
        error: {
            message: 'Internal server error',
            type: 'server_error',
            code: 'internal_error'
        }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: {
            message: 'Endpoint not found',
            type: 'invalid_request_error',
            code: 'not_found'
        }
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log('🚀 Starting Claude Autopilot API Server...');
    console.log(`📡 Port: ${PORT}`);
    console.log('🔗 This server provides OpenAI-compatible API endpoints for Claude CLI');
    console.log('');
    console.log('✅ Server started successfully!');
    console.log('');
    console.log('🔧 Available endpoints:');
    console.log(`   GET  http://localhost:${PORT}/health`);
    console.log(`   GET  http://localhost:${PORT}/v1/models`);
    console.log(`   POST http://localhost:${PORT}/v1/chat/completions`);
    console.log('');
    console.log('🔑 Authentication: Use any API key in Authorization header');
    console.log('   Example: Authorization: Bearer your-api-key-here');
    console.log('');
    console.log('🛑 Press Ctrl+C to stop the server');
});

// Graceful shutdown
const shutdown = () => {
    console.log('\n⏹️  Shutting down server...');
    server.close(() => {
        console.log('✅ Server stopped');
        process.exit(0);
    });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
        process.exit(1);
    } else {
        logger.error('Server error:', error);
        process.exit(1);
    }
});