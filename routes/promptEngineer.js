const express = require('express');
const router = express.Router();
const PromptEngineerService = require('../services/promptEngineerService');
const ImprovedCreditSystem = require('../services/improvedCreditSystem');
const admin = require('firebase-admin');

const promptService = new PromptEngineerService();
const creditSystem = new ImprovedCreditSystem();

// Middleware to verify Firebase ID token
const verifyToken = async (req, res, next) => {
    try {
        const idToken = req.headers.authorization?.split('Bearer ')[1];
        if (!idToken) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Optimize prompt endpoint
router.post('/optimize', verifyToken, async (req, res) => {
    try {
        const { prompt, category = 'general' } = req.body;
        const userId = req.user.uid;

        if (!prompt || prompt.trim().length === 0) {
            return res.status(400).json({ 
                error: 'Prompt is required and cannot be empty' 
            });
        }

        const validCategories = ['general', 'academic', 'creative', 'technical', 'business'];
        if (!validCategories.includes(category)) {
            return res.status(400).json({ 
                error: 'Invalid category. Must be one of: ' + validCategories.join(', ') 
            });
        }

        const result = await promptService.optimizePrompt(prompt, category, userId);
        
        // Handle limit exceeded responses
        if (!result.success && result.error === 'LIMIT_EXCEEDED') {
            return res.status(429).json({
                error: result.message,
                limitExceeded: true
            });
        }
        
        // Handle insufficient credits
        if (!result.success && result.error === 'INSUFFICIENT_CREDITS') {
            return res.status(402).json({
                error: result.message,
                insufficientCredits: true
            });
        }
        
        res.json(result);

    } catch (error) {
        console.error('Prompt optimization error:', error);
        
        if (error.message.includes('insufficient credits')) {
            return res.status(402).json({ 
                error: error.message,
                insufficientCredits: true 
            });
        }
        
        res.status(500).json({ 
            error: error.message || 'Failed to optimize prompt' 
        });
    }
});

// Analyze prompt quality endpoint
router.post('/analyze', verifyToken, async (req, res) => {
    try {
        const { prompt } = req.body;
        const userId = req.user.uid;

        if (!prompt || prompt.trim().length === 0) {
            return res.status(400).json({ 
                error: 'Prompt is required and cannot be empty' 
            });
        }

        const result = await promptService.analyzePromptWithCredits(prompt, userId);
        
        // Handle limit exceeded responses
        if (!result.success && result.error === 'LIMIT_EXCEEDED') {
            return res.status(429).json({
                error: result.message,
                limitExceeded: true
            });
        }
        
        // Handle insufficient credits
        if (!result.success && result.error === 'INSUFFICIENT_CREDITS') {
            return res.status(402).json({
                error: result.message,
                insufficientCredits: true
            });
        }
        
        res.json(result);

    } catch (error) {
        console.error('Prompt analysis error:', error);
        
        if (error.message.includes('insufficient credits')) {
            return res.status(402).json({ 
                error: error.message,
                insufficientCredits: true 
            });
        }
        
        res.status(500).json({ 
            error: error.message || 'Failed to analyze prompt' 
        });
    }
});

// Get prompt history endpoint (with pagination + filtering + summary)
router.get('/history', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const limit = parseInt(req.query.limit) || 20;
        const type = req.query.type || 'all'; // 'analysis' | 'optimization' | 'all'
        const cursor = req.query.cursor || null; // pagination cursor (last doc id)

        if (limit > 100) {
            return res.status(400).json({ 
                error: 'Limit cannot exceed 100' 
            });
        }

        // Fetch history from service
        const history = await promptService.getPromptHistory(userId, limit + 1, type, cursor);

        // Handle pagination
        const hasMore = history.length > limit;
        const items = hasMore ? history.slice(0, limit) : history;
        const nextCursor = hasMore ? history[limit - 1]?.id : null;

        // Calculate credit summary
        const totalCreditsUsed = items.reduce((sum, h) => sum + (h.creditsUsed || 0), 0);

        res.json({
            success: true,
            history: items,
            pagination: {
                hasMore,
                nextCursor
            },
            summary: {
                totalCreditsUsed,
                count: items.length
            }
        });

    } catch (error) {
        console.error('Get prompt history error:', error);
        res.status(500).json({ 
            error: 'Failed to retrieve prompt history' 
        });
    }
});

// Get quick templates endpoint
router.get('/templates', (req, res) => {
    try {
        const templates = promptService.getQuickTemplates();
        res.json({
            success: true,
            templates
        });
    } catch (error) {
        console.error('Get templates error:', error);
        res.status(500).json({ 
            error: 'Failed to retrieve templates' 
        });
    }
});

// Get user credits endpoint
router.get('/credits', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const credits = await creditSystem.getUserCredits(userId);

res.json({
    success: true,
    credits,
    costs: creditSystem.CREDIT_RATIOS.promptEngineer
});

    } catch (error) {
        console.error('Get credits error:', error);
        res.status(500).json({ 
            error: 'Failed to retrieve credits' 
        });
    }
});

// Validate user plan endpoint
router.get('/validate', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const validation = await promptService.planValidator.validateUserPlan(userId);
        
        res.json({
            success: true,
            validation
        });
    } catch (error) {
        console.error('Plan validation error:', error);
        res.status(500).json({ 
            error: 'Failed to validate plan' 
        });
    }
});

// Get user credit information endpoint
router.get('/credit-info', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const creditInfo = await promptService.getUserCreditInfo(userId);
        
        res.json(creditInfo);
    } catch (error) {
        console.error('Get credit info error:', error);
        res.status(500).json({ 
            error: 'Failed to retrieve credit information' 
        });
    }
});


module.exports = router;
