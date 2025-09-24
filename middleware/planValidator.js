const db = require('../database/db');
const UsageTracker = require('./usageTracker');
const { logger } = require('../utils/logger');

/**
 * PlanValidator class handles user plan validation and freemium restrictions
 * Implements strict checks for prompt length, output limits, and monthly usage
 */
class PlanValidator {
    constructor() {
        this.usageTracker = new UsageTracker();
        this.planTypes = {
            FREEMIUM: 'freemium',
            PRO: 'pro',
            CUSTOM: 'custom'
        };
        
       this.limits = {
           freemium: {
               monthlyCredits: 200,   // example: 200 credits/month },
               pro: { monthlyCredits: 2000,  // example: 2000 credits/month },
               custom: { monthlyCredits: null,  // unlimited or defined by contract }
        };
    }

    /**
     * Validate user request against plan limitations
     * @param {number} userId - User ID
     * @param {string} prompt - User's input prompt
     * @param {number} requestedWordCount - Requested output word count
     * @param {string} toolType - Type of tool ('writing' or 'research')
     * @returns {Object} Validation result
     */
    async validateRequest(userId, prompt, requestedWordCount, toolType = 'writing') {
        try {
            // Get user plan information
            const userPlan = await this.getUserPlan(userId);
            if (!userPlan) {
                return {
                    isValid: false,
                    error: 'User plan not found',
                    errorCode: 'PLAN_NOT_FOUND'
                };
            }

            const planLimits = this.limits[userPlan.planType]; 
            if (!planLimits) {
                return {
                    isValid: false,
                    error: 'Invalid plan type',
                    errorCode: 'INVALID_PLAN'
    };
}

         // ✅ Only check credits now (no word length checks) 
            const creditValidation = await this.validateCreditAvailability(
                userId,
                requestedWordCount,
                userPlan.planType,
                toolType
     );

          if (!creditValidation.isValid) {
              return creditValidation; 
          }

          return {
              isValid: true,
              userPlan,
              requestedWordCount,
              estimatedCredits: creditValidation.estimatedCredits
     };

    /**
     * Validate monthly usage limits for freemium users
     * @param {number} userId - User ID
     * @param {number} requestedWordCount - Requested output word count
     * @returns {Object} Validation result
     */
    async validateMonthlyLimits(userId, requestedWordCount) {
        try {
            const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM format
            
            // Get current month's usage
            const monthlyUsage = await this.getMonthlyUsage(userId, currentMonth);
            
            const monthlyWordLimit = this.limits.freemium.monthlyWordLimit;
            const monthlyCreditLimit = this.limits.freemium.monthlyCreditLimit;
            
            // Check word limit
            if (monthlyUsage.totalWords >= monthlyWordLimit) {
                return {
                    isValid: false,
                    error: 'Monthly word limit reached. Upgrade to Pro for unlimited generation!',
                    errorCode: 'MONTHLY_WORD_LIMIT_REACHED',
                    currentUsage: monthlyUsage.totalWords,
                    monthlyLimit: monthlyWordLimit
                };
            }
            
            // Check if this request would exceed the monthly word limit
            if (monthlyUsage.totalWords + requestedWordCount > monthlyWordLimit) {
                return {
                    isValid: false,
                    error: `This request would exceed your monthly word limit. Remaining: ${monthlyWordLimit - monthlyUsage.totalWords} words.`,
                    errorCode: 'MONTHLY_WORD_LIMIT_WOULD_EXCEED',
                    currentUsage: monthlyUsage.totalWords,
                    requestedWords: requestedWordCount,
                    remainingWords: monthlyWordLimit - monthlyUsage.totalWords,
                    monthlyLimit: monthlyWordLimit
                };
            }
            
            // Check credit limit
            if (monthlyUsage.totalCredits >= monthlyCreditLimit) {
                return {
                    isValid: false,
                    error: 'Monthly credit limit reached. Upgrade to Pro for unlimited generation!',
                    errorCode: 'MONTHLY_CREDIT_LIMIT_REACHED',
                    currentUsage: monthlyUsage.totalCredits,
                    monthlyLimit: monthlyCreditLimit
                };
            }
            
            return {
                isValid: true,
                monthlyUsage,
                remainingWords: monthlyWordLimit - monthlyUsage.totalWords,
                remainingCredits: monthlyCreditLimit - monthlyUsage.totalCredits
            };
            
        } catch (error) {
            logger.error('Error validating monthly limits', {
                service: 'PlanValidator',
                method: 'validateMonthlyLimits',
                userId,
                error: error.message
            });
            return {
                isValid: false,
                error: 'Failed to validate monthly limits',
                errorCode: 'MONTHLY_VALIDATION_ERROR'
            };
        }
    }

    /**
     * Validate credit availability for the request
     * @param {number} userId - User ID
     * @param {number} requestedWordCount - Requested output word count
     * @param {string} planType - User's plan type
     * @param {string} toolType - Type of tool ('writing' or 'research')
     * @returns {Object} Validation result
     */
    async validateCreditAvailability(userId, requestedWordCount, planType, toolType = 'writing') {
        try {
            // Get user's current credit balance
            const userCredits = await this.getUserCredits(userId);
            
            // Estimate credits needed for this request
            const estimatedCredits = this.estimateCreditsNeeded(requestedWordCount, planType, toolType);
            
            if (userCredits.availableCredits < estimatedCredits) {
                return {
                    isValid: false,
                    error: 'Insufficient credits for this request',
                    errorCode: 'INSUFFICIENT_CREDITS',
                    availableCredits: userCredits.availableCredits,
                    estimatedCredits,
                    planType
                };
            }
            
            return {
                isValid: true,
                availableCredits: userCredits.availableCredits,
                estimatedCredits
            };
            
        } catch (error) {
            logger.error('Error validating credit availability', {
                service: 'PlanValidator',
                method: 'validateCreditAvailability',
                userId,
                error: error.message
            });
            return {
                isValid: false,
                error: 'Failed to validate credit availability',
                errorCode: 'CREDIT_VALIDATION_ERROR'
            };
        }
    }

    /**
     * Get user plan information
     * @param {number} userId - User ID
     * @returns {Object} User plan data
     */
    async getUserPlan(userId) {
        try {
            const query = `
                SELECT 
                    u.id,
                    u.plan_type,
                    u.credits,
                    u.created_at,
                    u.updated_at
                FROM users u 
                WHERE u.id = ?
            `;
            
            const result = await db.query(query, [userId]);
            
            if (result.length === 0) {
                return null;
            }
            
            return {
                userId: result[0].id,
                planType: result[0].plan_type || this.planTypes.FREEMIUM,
                credits: result[0].credits || 0,
                createdAt: result[0].created_at,
                updatedAt: result[0].updated_at
            };
            
        } catch (error) {
            logger.error('Error getting user plan', {
                service: 'PlanValidator',
                method: 'getUserPlan',
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get monthly usage for a user (delegated to UsageTracker)
     * @param {number} userId - User ID
     * @param {string} month - Month in YYYY-MM format
     * @returns {Object} Monthly usage data
     */
    async getMonthlyUsage(userId, month) {
        try {
            return await this.usageTracker.getMonthlyUsage(userId, month);
        } catch (error) {
            logger.error('Error getting monthly usage', {
                service: 'PlanValidator',
                method: 'getMonthlyUsage',
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get user's current credit balance
     * @param {number} userId - User ID
     * @returns {Object} Credit information
     */
    async getUserCredits(userId) {
        try {
            const query = `
                SELECT credits 
                FROM users 
                WHERE id = ?
            `;
            
            const result = await db.query(query, [userId]);
            
            if (result.length === 0) {
                throw new Error('User not found');
            }
            
            return {
                availableCredits: result[0].credits || 0
            };
            
        } catch (error) {
            logger.error('Error getting user credits', {
                service: 'PlanValidator',
                method: 'getUserCredits',
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Estimate credits needed for content generation
     * @param {number} wordCount - Requested word count
     * @param {string} planType - User's plan type
     * @param {string} toolType - Type of tool ('writing' or 'research')
     * @returns {number} Estimated credits
     */
    estimateCreditsNeeded(wordCount, planType, toolType = 'writing') {
        // Credit ratios for different tools (purely credit-based, no plan multipliers)
        const ratios = {
            writing: 3,              // 1 credit per 3 words for Writer/Assignments
            research: 5,             // 1 credit per 5 words for Research Tool
            detector_detection: 0.05, // 50 credits per 1000 words for Detector Detection
            detector_generation: 5,   // 1 credit per 5 words for Detector Generation
            prompt_engineer: 100     // 1 credit per 100 words for Prompt Engineer
        };
        
        const ratio = ratios[toolType] || ratios.writing;
        
        // For detector detection, calculate differently (50 credits per 1000 words)
        if (toolType === 'detector_detection') {
            return Math.ceil((wordCount / 1000) * 50);
        }
        
        // For other tools, use standard ratio calculation
        return Math.ceil(wordCount / ratio);
    }

    /**
     * Count words in text
     * @param {string} text - Text to count
     * @returns {number} Word count
     */
    countWords(text) {
        if (!text || typeof text !== 'string') {
            return 0;
        }
        
        return text.trim().split(/\s+/).filter(word => word.length > 0).length;
    }

    /**
     * Get plan limits for a specific plan type
     * @param {string} planType - Plan type
     * @returns {Object} Plan limits
     */
    getPlanLimits(planType) {
        return this.limits[planType] || null;
    }

    /**
     * Record usage after successful content generation
     * @param {number} userId - User ID
     * @param {number} wordsGenerated - Words generated
     * @param {number} creditsUsed - Credits consumed
     * @param {Object} metadata - Additional metadata
     * @returns {Promise<Object>} Updated usage statistics
     */
    async recordUsage(userId, wordsGenerated, creditsUsed, metadata = {}) {
        try {
            return await this.usageTracker.recordUsage(userId, wordsGenerated, creditsUsed, metadata);
        } catch (error) {
            logger.error('Error recording usage', {
                service: 'PlanValidator',
                method: 'recordUsage',
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get usage history for a user
     * @param {number} userId - User ID
     * @param {number} months - Number of months to retrieve
     * @returns {Promise<Array>} Usage history
     */
    async getUserUsageHistory(userId, months = 6) {
        try {
            return await this.usageTracker.getUserUsageHistory(userId, months);
        } catch (error) {
            logger.error('Error getting usage history', {
                service: 'PlanValidator',
                method: 'getUserUsageHistory',
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get freemium limits
     * @returns {Object} Freemium limits
     */
    getFreemiumLimits() {
        return this.usageTracker.getFreemiumLimits();
    }

    /**
     * Check if user can upgrade their plan
     * @param {string} currentPlan - Current plan type
     * @returns {Object} Upgrade options
     */
    getUpgradeOptions(currentPlan) {
        const upgradeOptions = {
            freemium: {
                canUpgrade: true,
                recommendedPlan: 'pro',
                benefits: [
                    'Unlimited monthly word generation',
                    'Longer prompts (up to 1000 words)',
                    'Priority processing',
                    'Advanced export formats'
                ]
            },
            pro: {
                canUpgrade: true,
                recommendedPlan: 'custom',
                benefits: [
                    'Custom credit rates',
                    'Dedicated support',
                    'API access',
                    'Custom integrations'
                ]
            },
            custom: {
                canUpgrade: false,
                recommendedPlan: null,
                benefits: []
            }
        };
        
        return upgradeOptions[currentPlan] || upgradeOptions.freemium;
    }
}

module.exports = PlanValidator;
