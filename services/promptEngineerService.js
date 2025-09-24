const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');
const ImprovedCreditSystem = require('./improvedCreditSystem');
const PlanValidator = require('./planValidator');
const { logger } = require('../utils/logger');

class PromptEngineerService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

        try {
            this.db = admin.firestore();
        } catch (error) {
            logger.warn('Firebase not initialized, using mock database for prompt engineer service', {
                service: 'PromptEngineerService',
                method: 'constructor'
            });
            this.db = null;
        }

        this.creditSystem = new ImprovedCreditSystem();
        this.planValidator = new PlanValidator();
    }

    calculateWordCount(text) {
        if (!text || typeof text !== 'string') return 0;
        return text.trim().split(/\s+/).filter(word => word.length > 0).length;
    }

    async analyzePromptQuality(prompt) {
        try {
            const analysisPrompt = `
Analyze the following prompt and provide a detailed quality assessment. Return your response in JSON format with the following structure:

{
  "clarity": { "score": 0-100, "feedback": "..." },
  "specificity": { "score": 0-100, "feedback": "..." },
  "context": { "score": 0-100, "feedback": "..." },
  "overall": { "score": 0-100, "feedback": "..." },
  "strengths": ["..."],
  "improvements": ["..."]
}

Prompt to analyze:
"${prompt}"
`;

            const result = await this.model.generateContent(analysisPrompt);
            const response = result.response;
            const text = response.text();

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }

            return {
                clarity: { score: 50, feedback: "Unable to analyze clarity" },
                specificity: { score: 50, feedback: "Unable to analyze specificity" },
                context: { score: 50, feedback: "Unable to analyze context" },
                overall: { score: 50, feedback: "Analysis failed" },
                strengths: [],
                improvements: ["Please try submitting your prompt again"]
            };
        } catch (error) {
            logger.error('Error analyzing prompt quality', { error: error.message, stack: error.stack });
            throw new Error('Failed to analyze prompt quality');
        }
    }

   async checkLimitsAndCredits(userId, inputWords, estimatedOutputWords) {
    const planValidation = await this.planValidator.validateRequest(
        userId,
        "", // no need to pass content here, just checking credits
        inputWords + estimatedOutputWords,
        "promptEngineer"
    );

    if (!planValidation.isValid) {
        return {
            canProceed: false,
            creditsNeeded: 0,
            limitExceeded: true,
            userPlan: planValidation.userPlan || "free",
            message: planValidation.error || "Plan validation failed"
        };
    }

    // 🔹 Use ImprovedCreditSystem directly
    const creditsNeeded = this.creditSystem.calculateRequiredCredits(
        inputWords + estimatedOutputWords,
        "promptEngineer"
    );

    return {
        canProceed: true,
        creditsNeeded,
        limitExceeded: false,
        userPlan: planValidation.userPlan,
        message: ""
    };
}

    async optimizePrompt(originalPrompt, category = 'general', userId) {
        try {
            const inputWords = this.calculateWordCount(originalPrompt);
            const estimatedOutputWords = Math.min(inputWords * 1.5, 1000);

            const limitCheck = await this.checkLimitsAndCredits(userId, inputWords, estimatedOutputWords);

            if (!limitCheck.canProceed) {
                return { success: false, error: 'LIMIT_EXCEEDED', message: limitCheck.message };
            }

            let creditTransaction = null;
            let billingWords = 0;

            if (limitCheck.creditsNeeded > 0) {
                billingWords = inputWords + estimatedOutputWords;

                creditTransaction = await this.creditSystem.deductCreditsAtomic(
                    userId,
                    billingWords,                // ✅ words, not credits
                    limitCheck.userPlan,
                    'promptEngineer',
                    'deduction'
                );

                if (!creditTransaction.success) {
                    return { success: false, error: 'INSUFFICIENT_CREDITS', message: creditTransaction.message };
                }
            }

            try {
                const optimizationPrompt = `
You are an expert prompt engineer. Optimize the following prompt:

Category: ${category}
Original Prompt: "${originalPrompt}"

Return JSON:
{
  "optimizedPrompt": "optimized version",
  "improvements": ["..."],
  "explanation": "why changes help",
  "categoryTips": "tips for ${category} prompts"
}`;

                const result = await this.model.generateContent(optimizationPrompt);
                const response = result.response;
                const text = response.text();

                const jsonMatch = text.match(/\{[\s\S]*\}/);
                let optimizationResult;

                if (jsonMatch) {
                    optimizationResult = JSON.parse(jsonMatch[0]);
                } else {
                    optimizationResult = {
                        optimizedPrompt: text,
                        improvements: ["General optimization applied"],
                        explanation: "Optimized for clarity and effectiveness",
                        categoryTips: `Consider ${category}-specific best practices`
                    };
                }

                const actualOutputWords = this.calculateWordCount(optimizationResult.optimizedPrompt);

                await this.storeOptimizationResult(userId, {
                    originalPrompt,
                    optimizedPrompt: optimizationResult.optimizedPrompt,
                    category,
                    improvements: optimizationResult.improvements,
                    explanation: optimizationResult.explanation,
                    categoryTips: optimizationResult.categoryTips,
                    inputWords,
                    outputWords: actualOutputWords,
                    creditsUsed: limitCheck.creditsNeeded || 0,
                    billingWords,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                return {
                    success: true,
                    ...optimizationResult,
                    inputWords,
                    outputWords: actualOutputWords,
                    creditsUsed: limitCheck.creditsNeeded || 0,
                    billingWords
                };

            } catch (err) {
                if (creditTransaction) {
                    await this.creditSystem.rollbackTransaction(
                        userId,
                        creditTransaction.transactionId,
                        limitCheck.creditsNeeded || 0,
                        billingWords
                    );
                }
                throw err;
            }

        } catch (error) {
            logger.error('Error optimizing prompt', { error: error.message, stack: error.stack });
            throw new Error(error.message || 'Failed to optimize prompt');
        }
    }

    async analyzePromptWithCredits(prompt, userId) {
        try {
            const inputWords = this.calculateWordCount(prompt);
            const estimatedOutputWords = 200;

            const limitCheck = await this.checkLimitsAndCredits(userId, inputWords, estimatedOutputWords);

            if (!limitCheck.canProceed) {
                return { success: false, error: 'LIMIT_EXCEEDED', message: limitCheck.message };
            }

            let creditTransaction = null;
            let billingWords = 0;

            if (limitCheck.creditsNeeded > 0) {
                billingWords = inputWords + estimatedOutputWords;

                creditTransaction = await this.creditSystem.deductCreditsAtomic(
                    userId,
                    billingWords,
                    limitCheck.userPlan,
                    'promptEngineer',
                    'deduction'
                );

                if (!creditTransaction.success) {
                    return { success: false, error: 'INSUFFICIENT_CREDITS', message: creditTransaction.message };
                }
            }

            try {
                const analysis = await this.analyzePromptQuality(prompt);
                const actualOutputWords = 200;

                await this.storeAnalysisResult(userId, {
                    prompt,
                    analysis,
                    inputWords,
                    outputWords: actualOutputWords,
                    creditsUsed: limitCheck.creditsNeeded || 0,
                    billingWords,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                return {
                    success: true,
                    analysis,
                    inputWords,
                    outputWords: actualOutputWords,
                    creditsUsed: limitCheck.creditsNeeded || 0,
                    billingWords
                };

            } catch (err) {
                if (creditTransaction) {
                    await this.creditSystem.rollbackTransaction(
                        userId,
                        creditTransaction.transactionId,
                        limitCheck.creditsNeeded || 0,
                        billingWords
                    );
                }
                throw err;
            }

        } catch (error) {
            logger.error('Error analyzing prompt with credits', { error: error.message, stack: error.stack });
            throw new Error(error.message || 'Failed to analyze prompt');
        }
    }

    async getUserCreditInfo(userId) {
        try {
            const planValidation = await this.planValidator.validateUserPlan(userId);
            const userPlan = planValidation.isValid ? (planValidation.plan || 'free') : 'free';

            let currentCredits = 0;

            if (this.db) {
                try {
                    const userDoc = await this.db.collection('users').doc(userId).get();
                    const userData = userDoc.exists ? userDoc.data() : {};
                    currentCredits = userData.credits || 0;
                } catch {
                    currentCredits = 100;
                }
            } else {
                currentCredits = 100;
            }

            return { success: true, userPlan, currentCredits, creditRatios: this.creditSystem.CREDIT_RATIOS };
        } catch (error) {
            throw new Error('Failed to get credit information');
        }
    }

    async storeOptimizationResult(userId, data) {
        if (this.db) {
            await this.db.collection('promptOptimizations').add({ userId, ...data });
        }
    }

    async storeAnalysisResult(userId, data) {
        if (this.db) {
            await this.db.collection('promptAnalyses').add({ userId, ...data });
        }
    }

    async getPromptHistory(userId, limit = 20) {
        try {
            if (this.db) {
                const optimizations = await this.db.collection('promptOptimizations')
                    .where('userId', '==', userId)
                    .orderBy('timestamp', 'desc')
                    .limit(limit)
                    .get();

                const analyses = await this.db.collection('promptAnalyses')
                    .where('userId', '==', userId)
                    .orderBy('timestamp', 'desc')
                    .limit(limit)
                    .get();

                const history = [
                    ...optimizations.docs.map(doc => ({ id: doc.id, type: 'optimization', ...doc.data() })),
                    ...analyses.docs.map(doc => ({ id: doc.id, type: 'analysis', ...doc.data() }))
                ];

                history.sort((a, b) => b.timestamp?.toMillis() - a.timestamp?.toMillis());

                return history;
            } else {
                return [];
            }
        } catch (error) {
            throw new Error('Failed to retrieve prompt history');
        }
    }

    getQuickTemplates() {
        return {
            general: [
                "Please explain [topic] in simple terms...",
                "Create a step-by-step guide for [task]...",
                "Compare and contrast [A] and [B]..."
            ],
            academic: [
                "Analyze [topic] from the perspective of [framework]...",
                "Develop a research question about [subject]...",
                "Summarize the key findings of [area]..."
            ],
            creative: [
                "Write a [genre] story about [character]...",
                "Create a character description for [type]...",
                "Generate creative ideas for [project]..."
            ],
            technical: [
                "Explain how to implement [concept] in [language]...",
                "Debug this [language] code: [code snippet]...",
                "Design a system architecture for [app]..."
            ],
            business: [
                "Create a strategy for [company/product]...",
                "Analyze market potential for [product]...",
                "Develop a marketing plan for [product/service]..."
            ]
        };
    }
}

module.exports = PromptEngineerService;
