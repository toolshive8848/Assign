const admin = require('firebase-admin');
const { doc, getDoc } = require('firebase-admin/firestore');
const db = admin.firestore();
const UsageTracker = require('./usageTracker');
const { logger } = require('../utils/logger');
const ImprovedCreditSystem = require("./improvedCreditSystem");

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
    freemium: { monthlyCredits: 200 },   // example: 200 credits/month
    pro: { monthlyCredits: 2000 },       // example: 2000 credits/month
    custom: { monthlyCredits: null }     // unlimited or defined by contract
};

    }
          estimateCreditsNeeded(wordCount, planType, toolType = "writing", quality = "standard") {
        const creditSystem = new ImprovedCreditSystem();
        return creditSystem.calculateRequiredCredits(wordCount, toolType, quality);
    }

       /**
     * Validate if user has enough credits for the request
     */
    async validateCreditAvailability(userId, requestedWordCount, planType, toolType = 'writing', quality = 'standard') {
        try {
            const creditSystem = new ImprovedCreditSystem();
            const estimatedCredits = creditSystem.calculateRequiredCredits(requestedWordCount, toolType, quality);

            const { availableCredits } = await this.getUserCredits(userId);

            if (availableCredits < estimatedCredits) {
                return {
                    isValid: false,
                    error: 'Insufficient credits',
                    errorCode: 'INSUFFICIENT_CREDITS',
                    availableCredits,
                    estimatedCredits
                };
            }

            return {
                isValid: true,
                estimatedCredits,
                availableCredits
            };
        } catch (error) {
            logger.error("Error validating credit availability", { 
                service: "PlanValidator", 
                method: "validateCreditAvailability", 
                userId, 
                error: error.message 
            });
            return {
                isValid: false,
                error: 'Failed to validate credits',
                errorCode: 'CREDIT_VALIDATION_ERROR'
            };
        }
    }


    /**
     * Validate monthly usage limits for freemium users
     * @param {number} userId - User ID
     * @param {number} requestedWordCount - Requested output word count
     * @returns {Object} Validation result
     */
    async validateMonthlyLimits(userId, requestedCredits) {
    try {
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const monthlyUsage = await this.getMonthlyUsage(userId, currentMonth);

        const monthlyCreditLimit = this.limits.freemium.monthlyCredits;

        if (monthlyCreditLimit && monthlyUsage.totalCredits >= monthlyCreditLimit) {
            return {
                isValid: false,
                error: 'Monthly credit limit reached. Upgrade to Pro for more credits!',
                errorCode: 'MONTHLY_CREDIT_LIMIT_REACHED',
                currentUsage: monthlyUsage.totalCredits,
                monthlyLimit: monthlyCreditLimit
            };
        }

        return {
            isValid: true,
            monthlyUsage,
            remainingCredits: monthlyCreditLimit
                ? monthlyCreditLimit - monthlyUsage.totalCredits
                : null
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
     * Get user plan information
     * @param {number} userId - User ID
     * @returns {Object} User plan data
     */
    async getUserPlan(userId) {
    try {
        const userRef = db.collection("users").doc(userId);
        const snap = await userRef.get();

        if (!snap.exists) return null;

        const data = snap.data();
        return {
            userId,
            planType: data.planType || this.planTypes.FREEMIUM,
            credits: data.credits || 0,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt
        };
    } catch (error) {
        logger.error("Error getting user plan", { method: "getUserPlan", error: error.message });
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
        const userRef = db.collection("users").doc(userId);
        const snap = await userRef.get();

        if (!snap.exists) throw new Error("User not found");

        const data = snap.data();
        return { availableCredits: data.credits || 0 };
    } catch (error) {
        logger.error("Error getting user credits", { method: "getUserCredits", error: error.message });
        throw error;
    }
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
