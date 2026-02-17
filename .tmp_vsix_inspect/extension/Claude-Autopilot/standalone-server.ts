#!/usr/bin/env node

/**
 * Standalone API Server Runner
 * 
 * This script runs the Claude Autopilot API server independently from the VS Code extension
 * for testing and development purposes.
 */

import { APIServer } from './src/api/server';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8000;

async function main() {
    console.log('🚀 Starting Claude Autopilot API Server...');
    console.log(`📡 Port: ${PORT}`);
    console.log('🔗 This server provides OpenAI-compatible API endpoints for Claude CLI');
    console.log('');

    const server = new APIServer(PORT);

    // Graceful shutdown handlers
    const shutdown = async () => {
        console.log('\n⏹️  Shutting down server...');
        await server.stop();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
        await server.start();
        
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
        
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

if (require.main === module) {
    main().catch((error) => {
        console.error('💥 Failed to start:', error);
        process.exit(1);
    });
}