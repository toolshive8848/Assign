// routes/research.js
const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");
const ImprovedCreditSystem = require("../services/improvedCreditSystem");
const ResearchService = require("../services/researchService");

const creditSystem = new ImprovedCreditSystem();
const researchService = new ResearchService();

// Dummy plan validator import (adjust if your project path differs)
const planValidator = require("../services/planValidator");

// Auth middleware
async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.split("Bearer ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Auth error:", err.message);
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * POST /api/research/query
 * Run a research query
 */
router.post("/query", requireAuth, async (req, res) => {
  const { query, depth = 1, researchType = "general", sources = [], saveToHistory = true } = req.body;
  const userId = req.user.uid;

  let creditDeductionResult = null;

  try {
    if (!query || query.length < 5) {
      return res.status(400).json({ success: false, error: "Query must be at least 5 characters long" });
    }

    // Step 1: Estimate words
    const estimatedWordCount = Math.min(depth * 1000, 8000);
    const estimatedCredits = researchService.calculateResearchCredits(estimatedWordCount, depth);

    // Step 2: Validate plan
    const planValidation = await planValidator.validateRequest(userId, query, estimatedWordCount, "research");
    if (!planValidation.isValid) {
      return res.status(403).json({
        success: false,
        error: planValidation.error,
        errorCode: planValidation.errorCode,
        details: {
          planType: planValidation.planType,
          currentUsage: planValidation.currentUsage,
          limits: planValidation.monthlyLimit || planValidation.maxLength || planValidation.maxCount
        }
      });
    }

    // Step 3: Deduct credits (words → credits inside ImprovedCreditSystem)
    creditDeductionResult = await creditSystem.deductCreditsAtomic(
      userId,
      estimatedWordCount,
      planValidation.userPlan.planType,
      "research"
    );

    if (!creditDeductionResult.success) {
      return res.status(402).json({
        success: false,
        error: "Insufficient credits for research",
        details: {
          required: estimatedCredits,
          available: creditDeductionResult.availableCredits,
          planType: planValidation.userPlan.planType
        }
      });
    }

    // Step 4: Conduct research
    const startTime = Date.now();
    const researchResult = await researchService.conductResearch(query, researchType, depth, sources, userId);
    const processingTime = Date.now() - startTime;

    // Step 5: Reconcile usage
    const actualWordCount = researchResult.wordCount;
    let finalCreditsUsed = creditDeductionResult.creditsDeducted;

    if (actualWordCount !== estimatedWordCount) {
      const wordDiff = actualWordCount - estimatedWordCount;

      if (wordDiff > 0) {
        const addl = await creditSystem.deductCreditsAtomic(
          userId,
          wordDiff,
          planValidation.userPlan.planType,
          "research"
        );
        if (addl.success) {
          finalCreditsUsed += addl.creditsDeducted;
        }
      } else if (wordDiff < 0) {
        const overWords = Math.abs(wordDiff);
        const refundCredits = Math.ceil(overWords / 5); // research ratio
        await creditSystem.refundCredits(userId, refundCredits, creditDeductionResult.transactionId);
        finalCreditsUsed -= refundCredits;
      }
    }

    // Step 6: Save to history
    let researchId = null;
    if (saveToHistory) {
      researchId = await researchService.saveResearchToHistory(userId, researchResult.data, {
        ...researchResult.metadata,
        processingTime,
        creditsUsed: finalCreditsUsed,
        transactionId: creditDeductionResult.transactionId,
        citations: researchResult.data.citations,
        sourceValidation: researchResult.data.sourceValidation,
        recommendations: researchResult.data.recommendations,
        qualityScore: researchResult.data.qualityScore
      });
    }

    // Step 7: Respond
    res.json({
      success: true,
      data: {
        researchId,
        query,
        researchType,
        depth,
        results: researchResult.data,
        metadata: {
          wordCount: researchResult.wordCount,
          processingTime,
          creditsUsed: finalCreditsUsed,
          timestamp: new Date().toISOString(),
          sources: researchResult.data.sources || [],
          citations: researchResult.data.citations || [],
          sourceValidation: researchResult.data.sourceValidation || {},
          recommendations: researchResult.data.recommendations || [],
          qualityScore: researchResult.data.qualityScore || 0
        }
      }
    });
  } catch (error) {
    console.error("Research query error:", error);

    if (creditDeductionResult && creditDeductionResult.success) {
      try {
        await creditSystem.rollbackTransaction(
          userId,
          creditDeductionResult.transactionId,
          creditDeductionResult.creditsDeducted,
          creditDeductionResult.wordsAllocated
        );
      } catch (rollbackError) {
        console.error("Credit rollback failed:", rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      error: "Research generation failed",
      details: error.message
    });
  }
});

/**
 * POST /api/research/validate-sources
 */
router.post("/validate-sources", requireAuth, async (req, res) => {
  const { sources } = req.body;
  const userId = req.user.uid;

  if (!sources || !Array.isArray(sources) || sources.length === 0) {
    return res.status(400).json({ success: false, error: "Sources array is required" });
  }

  try {
    const planValidation = await planValidator.validateRequest(userId, "", 0, "research");
    if (!planValidation.isValid) {
      return res.status(403).json({ success: false, error: planValidation.error });
    }

    const estimatedCredits = Math.ceil(sources.length * 0.5);
    const creditDeductionResult = await creditSystem.deductCreditsAtomic(
      userId,
      sources.length, // pass count, ratio applied inside
      planValidation.userPlan.planType,
      "research"
    );

    if (!creditDeductionResult.success) {
      return res.status(402).json({ success: false, error: "Insufficient credits for source validation" });
    }

    const validationResult = await researchService.validateSources(sources);

    await planValidator.recordUsage(userId, sources.length, estimatedCredits, "source_validation");

    res.json({
      success: true,
      data: {
        validatedSources: validationResult.validatedSources,
        overallScore: validationResult.overallScore,
        creditsUsed: estimatedCredits,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Source validation error:", error);
    res.status(500).json({ success: false, error: "Source validation failed", details: error.message });
  }
});

/**
 * POST /api/research/generate-citations
 */
router.post("/generate-citations", requireAuth, async (req, res) => {
  const { sources, format = "apa" } = req.body;
  const userId = req.user.uid;

  if (!sources || !Array.isArray(sources) || sources.length === 0) {
    return res.status(400).json({ success: false, error: "Sources array is required" });
  }

  try {
    const planValidation = await planValidator.validateRequest(userId, "", 0, "research");
    if (!planValidation.isValid) {
      return res.status(403).json({ success: false, error: planValidation.error });
    }

    const estimatedCredits = Math.ceil(sources.length * 0.3);
    const creditDeductionResult = await creditSystem.deductCreditsAtomic(
      userId,
      sources.length, // words-like unit for ratio
      planValidation.userPlan.planType,
      "research"
    );

    if (!creditDeductionResult.success) {
      return res.status(402).json({ success: false, error: "Insufficient credits for citation generation" });
    }

    const citationResult = await researchService.generateCitations(sources, format);

    await planValidator.recordUsage(userId, sources.length, estimatedCredits, "citation_generation");

    res.json({
      success: true,
      data: {
        citations: citationResult.citations,
        creditsUsed: estimatedCredits,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Citation generation error:", error);
    res.status(500).json({ success: false, error: "Citation generation failed", details: error.message });
  }
});

module.exports = router;
