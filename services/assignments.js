const express = require('express');
const jwt = require('jsonwebtoken');
const { Document, Packer, Paragraph } = require('docx');
const llmService = require('./services/llmService');
const ContentFormatter = require('./services/contentFormatter');
const PlanValidator = require('./services/planValidator');
const ImprovedCreditSystem = require('./services/improvedCreditSystem');
const MultiPartGenerator = require('./services/multiPartGenerator');
const OriginalityDetection = require('./services/originalityDetection');
const ZoteroCSLProcessor = require('./services/zoteroCSL');
const ContentHistoryService = require('./services/contentHistory');
const FinalDetectionService = require('./services/finalDetection');
const { unifiedAuth } = require('./middleware/unifiedAuth');
const { asyncErrorHandler } = require('./middleware/errorHandler');
const { validateAssignmentInput, handleValidationErrors } = require('./middleware/validation');
const admin = require('firebase-admin'); // Firestore
const router = express.Router();

// Initialize services
const contentFormatterInstance = new ContentFormatter();
const planValidatorInstance = new PlanValidator();
const improvedCreditSystem = new ImprovedCreditSystem();
const multiPartGenerator = new MultiPartGenerator();
const originalityDetection = new OriginalityDetection();
const zoteroCSLProcessor = new ZoteroCSLProcessor();
const contentHistoryService = new ContentHistoryService();
const finalDetectionService = new FinalDetectionService();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const authenticateToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

// Enhanced AI content generation service with style, tone, and citation support
const generateAssignmentContent = async (
    title, 
    description, 
    wordCount, 
    citationStyle, 
    style = 'Academic', 
    tone = 'Formal'
) => {
    // Style templates for tone/structure
    const styleTemplates = {
        Academic: {
            introduction: 'This scholarly examination explores',
            transition: 'Furthermore, research indicates that',
            conclusion: 'In conclusion, the evidence demonstrates'
        },
        Business: {
            introduction: 'This business analysis examines',
            transition: 'Market data suggests that',
            conclusion: 'The strategic implications indicate'
        },
        Creative: {
            introduction: 'Imagine a world where',
            transition: 'As we delve deeper into this narrative',
            conclusion: 'The story ultimately reveals'
        }
    };

    // Centralized citation templates
    const citationTemplates = {
        APA: `
Smith, J. (2023). Academic Writing in the Digital Age. Journal of Modern Education, 45(2), 123-145.
Johnson, M. & Brown, A. (2022). Research Methodologies for Students. Academic Press.
        `.trim(),

        MLA: `
Smith, John. "Academic Writing in the Digital Age." Journal of Modern Education, vol. 45, no. 2, 2023, pp. 123-145.
Johnson, Mary, and Anne Brown. Research Methodologies for Students. Academic Press, 2022.
        `.trim(),

        Harvard: `
Smith, J., 2023. Academic Writing in the Digital Age. Journal of Modern Education, 45(2), pp.123-145.
Johnson, M. & Brown, A., 2022. Research Methodologies for Students. Academic Press.
        `.trim(),

        Chicago: `
Smith, John. 2023. "Academic Writing in the Digital Age." Journal of Modern Education 45, no. 2: 123-145.
Johnson, Mary, and Anne Brown. 2022. Research Methodologies for Students. Academic Press.
        `.trim(),

        IEEE: `
[1] J. Smith, "Academic Writing in the Digital Age," Journal of Modern Education, vol. 45, no. 2, pp. 123-145, 2023.
[2] M. Johnson and A. Brown, Research Methodologies for Students. Academic Press, 2022.
        `.trim()
    };

    const selectedStyle = styleTemplates[style] || styleTemplates['Academic'];
    const references = citationTemplates[citationStyle?.toUpperCase()] || citationTemplates.Chicago;

    // Generate prompt for LLM
    const prompt = `Write a ${wordCount}-word ${style.toLowerCase()} ${tone.toLowerCase()} assignment on "${title}". ${description ? `Instructions: ${description}` : ''} Use ${citationStyle} citation style.`;

    try {
        // Try generating with LLM
        const generatedContent = await llmService.generateContent(prompt, {
            maxTokens: Math.ceil(wordCount * 1.5),
            temperature: 0.7,
            style,
            tone
        });

        return generatedContent;
    } catch (error) {
        console.error('Error generating content:', error);

        // Fallback to template-based content
        const fallbackContent = `
# ${title}

## Introduction
${selectedStyle.introduction} the topic of "${title}" with detailed analysis and research-based insights.

## Main Body
${selectedStyle.transition} [Content will be generated based on your requirements]

### Key Points
1. [Analysis point will be developed]
2. [Supporting evidence will be provided]
3. [Additional perspective will be added]
4. [Implications will be discussed]

## Analysis
[Detailed analysis will be provided based on research]

## Conclusion
${selectedStyle.conclusion} [Conclusion will be drawn from the analysis]

## References
${references}
        `.trim();

        return fallbackContent;
    }

    // Simulate slight delay
    await new Promise(resolve => setTimeout(resolve, 2000));
};

// Plagiarism checking service
const checkPlagiarism = async (content, options = {}) => {
    try {
        // Use the OriginalityDetection service for real plagiarism checking
        const result = await originalityDetection.checkOriginality(content, options);

        return {
            success: true,
            originalityScore: result.originalityScore || 0,
            plagiarismScore: result.plagiarismScore || (100 - (result.originalityScore || 0)),
            sources: result.sources || [],
            reportUrl: result.reportUrl || null,
            checkedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error('Error checking plagiarism:', error);

        // Fallback structured response
        return {
            success: false,
            originalityScore: null,
            plagiarismScore: null,
            sources: [],
            reportUrl: null,
            checkedAt: new Date().toISOString(),
            error: error.message
        };
    }
};

// Create new assignment
// New endpoint for AI Writer tool content generation
router.post('/generate', unifiedAuth, validateAssignmentInput, handleValidationErrors, asyncErrorHandler(async (req, res) => {
    const { prompt, style, tone, wordCount, subject, additionalInstructions, citationStyle, requiresCitations, 
    assignmentType = 'general', 
    quality = 'standard' } = req.body;
    const userId = req.user.id;

    // Validate input parameters
    if (!prompt || !wordCount) {
        return res.status(400).json({ error: 'Prompt and word count are required' });
    }

    if (wordCount < 100) {
        return res.status(400).json({ error: 'Word count must be at least 100' });
    }
    
    if (!['general', 'academic'].includes(assignmentType.toLowerCase())) {
  return res.status(400).json({ error: 'Invalid assignment type. Must be "general" or "academic".' });
    }

    if (!['standard', 'premium'].includes(quality.toLowerCase())) {
  return res.status(400).json({ error: 'Invalid quality. Must be "standard" or "premium".' });
    }

    // CRITICAL: Strict freemium checks and plan validation
    console.log(`Validating request for user ${userId}: prompt=${prompt.length} chars, wordCount=${wordCount}`);
    
    try {
        const planValidation = await planValidatorInstance.validateRequest(userId, prompt, wordCount, 'writing');
        
        if (!planValidation.isValid) {
            console.warn(`Plan validation failed for user ${userId}:`, planValidation.error);
            
            // Return specific error responses based on error code
            const statusCode = getStatusCodeForValidationError(planValidation.errorCode);
            
            return res.status(statusCode).json({
                error: planValidation.error,
                errorCode: planValidation.errorCode,
                details: {
                    planType: planValidation.planType,
                    currentUsage: planValidation.currentUsage,
                    limits: planValidation.monthlyLimit || planValidation.maxLength || planValidation.maxCount,
                    upgradeOptions: planValidation.planType ? planValidatorInstance.getUpgradeOptions(planValidation.planType) : null
                },
                timestamp: new Date().toISOString()
            });
        }
        
        console.log(`Plan validation passed for user ${userId}:`, {
            planType: planValidation.userPlan.planType,
            promptWords: planValidation.promptWordCount,
            requestedWords: planValidation.requestedWordCount,
            estimatedCredits: planValidation.estimatedCredits
        });
    } catch (validationError) {
        console.error('Plan validation error:', validationError);
        return res.status(500).json({ error: 'Plan validation failed' });
    }

    try {
        // Get user information and check credits let user;
        try {
    const userDoc = await admin.firestore().collection('users').doc(userId).get();

    if (!userDoc.exists) {
        return res.status(404).json({ error: 'User not found' });
    }
    user = userDoc.data(); // { credits, is_premium }
} catch (err) {
    console.error('Database error:', err);
    return res.status(500).json({ error: 'Database error' });
}
    if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            let creditMultiplier = 1; 
            if (quality.toLowerCase() === 'premium')  { 
                creditMultiplier = 2; 
            }
            
            const adjustedWordCount = Math.ceil(wordCount * creditMultiplier);
            
            const creditDeductionResult = await improvedCreditSystem.deductCreditsAtomic(
                req.user.id,
                wordCount, // Pass requested word count directly
                planValidation.userPlan.planType,
                'writing'
            );
            
          if (!creditDeductionResult.success) { 
              return res.status(402).json({ success: false, error: 'Insufficient credits. Please top-up.', errorCode: 'INSUFFICIENT_CREDITS', details: {
      // Always trust ImprovedCreditSystem for requiredCredits
             requiredCredits: creditDeductionResult.requiredCredits,
             currentBalance: creditDeductionResult.previousBalance ?? 0,
             shortfall: creditDeductionResult.requiredCredits - (creditDeductionResult.previousBalance ?? 0) }
        });
    }

            console.log(`Credits deducted successfully. Transaction ID: ${creditDeductionResult.transactionId}`);

            try {
                // Step 3: Multi-part LLM generation with iterative detection
                const generationResult = await multiPartGenerator.generateMultiPartContent({
                    userId: req.user.id,
                    prompt,
                    requestedWordCount: wordCount,
                    userPlan: planValidation.userPlan.planType || 'freemium',
                    style,
                    tone,
                    subject: subject || '',
                    additionalInstructions: additionalInstructions || '',
                    assignmentType,
                    quality 
                });
                
                // Step 4: Process citations if required
                let citationData = {
                    requiresCitations: false,
                    processedContent: generationResult.content,
                    bibliography: [],
                    inTextCitations: [],
                    citationCount: 0
                };
                
                if (requiresCitations && citationStyle) {
                    console.log(`Processing citations with style: ${citationStyle}`);
                    citationData = await zoteroCSLProcessor.processCitations(
                        generationResult.content,
                        citationStyle,
                        subject || prompt.substring(0, 100)
                    );
                }
                
                // Step 5: Final detection processing for combined content
                console.log('Running final detection on combined content');
                const finalDetectionResults = await finalDetectionService.processFinalDetection(
                    citationData.processedContent,
                    generationResult.chunkDetectionResults || [],
                    {
                        contentId: generationResult.contentId,
                        userId: req.user.id,
                        isMultiPart: generationResult.chunksGenerated > 1,
                        generationMethod: 'multi-part'
                    }
                );
                
                // Generate assignment ID
                const assignmentId = `assign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                
                try {
                    // Record usage after successful generation
                    await planValidatorInstance.recordUsage({
                        userId: req.user.id,
                        wordsGenerated: citationData.processedContent
                            ? citationData.processedContent.split(/\s+/).length : generationResult.wordCount,
                        creditsUsed: creditDeductionResult.creditsDeducted,
                        generationType: 'assignment'
                    });
                    
                    // Step 6: Save to content history with comprehensive metadata
                    const contentHistoryData = {
                        finalContent: citationData.processedContent,
                        title: `${subject || 'Assignment'} - ${new Date().toLocaleDateString()}`,
                        prompt,
                        style,
                        tone,
                        finalWordCount: citationData.processedContent ? citationData.processedContent.split(/\s+/).length : generationResult.wordCount,
                        isMultiPart: generationResult.chunksGenerated > 1,
                        chunksGenerated: generationResult.chunksGenerated,
                        refinementCycles: generationResult.refinementCycles,
                        finalDetectionResults,
                        citationsUsed: citationData.requiresCitations,
                        citationStyle: citationStyle || null,
                        citationCount: citationData.citationCount,
                        bibliography: citationData.bibliography,
                        generationTime: generationResult.generationTime,
                        creditsUsed: creditDeductionResult.creditsDeducted,
                        transactionId: creditDeductionResult.transactionId,
                        usedSimilarContent: generationResult.usedSimilarContent,
                        similarContentId: generationResult.similarContentId,
                        optimizationApplied: generationResult.usedSimilarContent,
                        userPlan: planValidation.userPlan.planType,
                        planLimits: planValidation.userPlan,
                        assignmentType,
                        quality,
                        tags: [subject, style, tone].filter(Boolean)
                    };
                    
                    const historyResult = await contentHistoryService.saveContentToHistory(req.user.id, contentHistoryData);
                    
                    const assignment = {
                        id: assignmentId,
                        userId: req.user.id,
                        prompt,
                        content: citationData.processedContent,
                        wordCount: contentHistoryData.finalWordCount,
                        style,
                        tone,
                        subject: subject || 'General',
                        additionalInstructions: additionalInstructions || '',
                        status: 'completed',
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        contentHistoryId: historyResult.contentId,
                        metadata: {
                            chunksGenerated: generationResult.chunksGenerated,
                            refinementCycles: generationResult.refinementCycles,
                            generationTime: generationResult.generationTime,
                            contentId: generationResult.contentId,
                            usedSimilarContent: generationResult.usedSimilarContent,
                            creditsUsed: creditDeductionResult.creditsDeducted,
                             transactionId: creditDeductionResult.transactionId,
                            citationsProcessed: citationData.requiresCitations,
                            finalDetectionScore: finalDetectionResults.qualityScore,
                            requiresReview: finalDetectionResults.requiresReview
                        }
                    };
                    
                    // Save to Firestore
                    await admin.firestore().collection('assignments').doc(assignmentId).set(assignment);
                    
                    res.json({
                        success: true,
                        assignment: {
                            id: assignment.id,
                            prompt: assignment.prompt,
                            content: assignment.content,
                            wordCount: assignment.wordCount,
                            style: assignment.style,
                            tone: assignment.tone,
                            subject: assignment.subject,
                            status: assignment.status,
                            createdAt: assignment.createdAt,
                            contentHistoryId: assignment.contentHistoryId,
                            metadata: assignment.metadata
                        },
                        generationStats: {
                            chunksGenerated: generationResult.chunksGenerated,
                            refinementCycles: generationResult.refinementCycles,
                            generationTime: generationResult.generationTime,
                            creditsUsed: creditDeductionResult.creditsDeducted,
                            usedSimilarContent: generationResult.usedSimilarContent
                        },
                        citationData: {
                            requiresCitations: citationData.requiresCitations,
                            citationStyle: citationStyle,
                            citationCount: citationData.citationCount,
                            bibliography: citationData.bibliography,
                            inTextCitations: citationData.inTextCitations
                        },
                        finalDetectionResults: {
                            originalityScore: finalDetectionResults.originalityScore,
                            aiDetectionScore: finalDetectionResults.aiDetectionScore,
                            plagiarismScore: finalDetectionResults.plagiarismScore,
                            qualityScore: finalDetectionResults.qualityScore,
                            severity: finalDetectionResults.severity,
                            confidence: finalDetectionResults.confidence,
                            requiresReview: finalDetectionResults.requiresReview,
                            isAcceptable: finalDetectionResults.isAcceptable,
                            recommendations: finalDetectionResults.recommendations
                        }
                    });
                } catch (generationError) {
                    console.error('Content generation failed, rolling back credits:', generationError);
                    
                    // Rollback credit deduction if generation fails
                    try {
                        await ImprovedCreditSystem.rollbackTransaction(
                            req.user.id,
                            creditDeductionResult.transactionId,
                            creditDeductionResult.creditsDeducted,
                            creditDeductionResult.wordsAllocated
                        );
                        console.log(`Credits rolled back for transaction: ${creditDeductionResult.transactionId}`);
                    } catch (rollbackError) {
                        console.error('Failed to rollback credits:', rollbackError);
                    }
                    
                    throw generationError;
                }
            } catch (generationError) {
                console.error('Content generation error:', generationError);
                return res.status(500).json({ error: 'Failed to generate content' });
            }
        });
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));

router.post(
  '/create',
  unifiedAuth,
  validateAssignmentInput,
  handleValidationErrors,
  asyncErrorHandler(async (req, res) => {
    const {
      title,
      description,
      wordCount,
      citationStyle,
      assignmentType = 'general',
      quality = 'standard'
    } = req.body;

    const userId = req.user.id;

    // ---- Validation checks ----
    if (!title || !wordCount || !citationStyle) {
      return res
        .status(400)
        .json({ error: 'Title, word count, and citation style are required' });
    }

    if (wordCount < 100 || wordCount > 5000) {
      return res
        .status(400)
        .json({ error: 'Word count must be between 100 and 5000' });
    }

    if (!['general', 'academic'].includes(assignmentType.toLowerCase())) {
      return res.status(400).json({
        error: 'Invalid assignment type. Must be "general" or "academic".'
      });
    }

    if (!['standard', 'premium'].includes(quality.toLowerCase())) {
      return res.status(400).json({
        error: 'Invalid quality. Must be "standard" or "premium".'
      });
    }

    // ---- Credit calculation (ImprovedCreditSystem) ----
    let creditMultiplier = quality.toLowerCase() === 'premium' ? 2 : 1;
    let adjustedWordCount = Math.ceil(wordCount * creditMultiplier);

    let creditDeductionResult;
    try {
      creditDeductionResult = await improvedCreditSystem.deductCreditsAtomic(
        userId,
        adjustedWordCount,
        'writing' // toolType = writing
      );

      if (!creditDeductionResult.success) {
        return res.status(402).json({
          success: false,
          error: 'Insufficient credits. Please top-up.',
          errorCode: 'INSUFFICIENT_CREDITS',
          details: {
            requiredCredits: creditDeductionResult.requiredCredits,
            currentBalance: creditDeductionResult.previousBalance ?? 0,
            shortfall:
              creditDeductionResult.requiredCredits -
              (creditDeductionResult.previousBalance ?? 0)
          }
        });
      }
    } catch (err) {
      console.error('Credit deduction failed:', err);
      return res
        .status(500)
        .json({ error: 'Internal server error during credit deduction' });
    }

}

 try {
             
  // Create assignment ID
  const assignmentId = `assign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Initial assignment record in Firestore
  const assignmentData = {
    id: assignmentId,
    userId,
    title,
    description,
    wordCount,
    citationStyle,
    assignmentType,
    quality,
    status: 'generating',
    creditsUsed: creditDeductionResult.creditsDeducted,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  await admin.firestore().collection('assignments').doc(assignmentId).set(assignmentData);

  // Respond early to client (async generation continues later)
  res.json({
    message: 'Assignment creation started',
    assignmentId,
    creditsUsed: creditDeductionResult.creditsDeducted
  });

  // ---- Generate content asynchronously ----
  try {
    const content = await generateAssignmentContent(title, description, wordCount, citationStyle);
    const originalityScore = await checkPlagiarism(content);

    // Update assignment with final results
    await admin.firestore().collection('assignments').doc(assignmentId).update({
      content,
      originalityScore,
      status: 'completed',
      updatedAt: new Date()
    });

    console.log(`Assignment ${assignmentId} completed successfully`);
  } catch (genError) {
    console.error('Error generating content:', genError);

    // Rollback credits if generation fails
    try {
      await improvedCreditSystem.rollbackTransaction(
        userId,
        creditDeductionResult.transactionId,
        creditDeductionResult.creditsDeducted,
        creditDeductionResult.wordsAllocated
      );
      console.log(`Credits rolled back for assignment ${assignmentId}`);
    } catch (rbErr) {
      console.error('Rollback failed:', rbErr);
    }

    await admin.firestore().collection('assignments').doc(assignmentId).update({
      status: 'failed',
      updatedAt: new Date()
    });
  }
} catch (err) {
  console.error('Assignment creation error:', err);
  return res.status(500).json({ error: 'Error creating assignment' });
}

// Get assignment by ID
router.get('/:id', unifiedAuth, asyncErrorHandler(async (req, res) => {
  const assignmentId = req.params.id;
  const userId = req.user.id;

  try {
    const docRef = admin.firestore().collection('assignments').doc(assignmentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const assignment = doc.data();

    // Security: make sure this assignment belongs to the requesting user
    if (assignment.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized access to this assignment' });
    }

    res.json({
      id: assignment.id,
      title: assignment.title,
      description: assignment.description,
      wordCount: assignment.wordCount,
      citationStyle: assignment.citationStyle,
      content: assignment.content || null,
      originalityScore: assignment.originalityScore || null,
      status: assignment.status,
      creditsUsed: assignment.creditsUsed,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt || null
    });
  } catch (err) {
    console.error('Error fetching assignment:', err);
    res.status(500).json({ error: 'Database error' });
  }
}));

// Get user's assignment history
router.get('/', unifiedAuth, asyncErrorHandler(async (req, res) => {
  const userId = req.user.id; // use `id`, not `userId`, since decode sets req.user.id

  try {
    const snapshot = await admin
      .firestore()
      .collection('assignments')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    if (snapshot.empty) {
      return res.json([]); // no assignments yet
    }

    const formattedAssignments = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title,
        wordCount: data.wordCount,
        citationStyle: data.citationStyle,
        status: data.status,
        originalityScore: data.originalityScore || null,
        creditsUsed: data.creditsUsed,
        createdAt: data.createdAt,
      };
    });

    res.json(formattedAssignments);
  } catch (err) {
    console.error('Error fetching assignment history:', err);
    res.status(500).json({ error: 'Database error' });
  }
}));

const { Document, Packer, Paragraph } = require('docx');

// Download assignment as a Word document
router.get('/:id/download', unifiedAuth, asyncErrorHandler(async (req, res) => {
  const assignmentId = req.params.id;
  const userId = req.user.id;

  try {
    const docRef = admin.firestore().collection('assignments').doc(assignmentId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const assignment = docSnap.data();

    if (assignment.userId !== userId || assignment.status !== 'completed') {
      return res.status(404).json({ error: 'Assignment not found or not completed' });
    }

    // Create Word document
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              text: assignment.title || "Assignment",
              heading: "Heading1",
            }),
            new Paragraph({
              text: assignment.content || "No content available",
            }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    const filename = `${assignment.title.replace(/[^a-zA-Z0-9]/g, '_')}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Error generating Word file' });
  }
}));

// Create new draft
router.post(
  '/drafts',
  unifiedAuth,
  validateAssignmentInput,
  handleValidationErrors,
  asyncErrorHandler(async (req, res) => {
    try {
      const { title, content, prompt, style, tone, targetWordCount } = req.body;
      const userId = req.user.id;

      if (!title || title.trim().length === 0) {
        return res.status(400).json({ error: 'Title is required' });
      }

      const draftId = `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const draftData = {
        id: draftId,
        userId,
        title: title.trim(),
        content: content || '',
        prompt: prompt || '',
        style: style || 'Academic',
        tone: tone || 'Formal',
        targetWordCount: targetWordCount || 0,
        status: 'in-progress',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Save draft to Firestore
      await admin.firestore().collection('drafts').doc(draftId).set(draftData);

      res.status(201).json({
        success: true,
        draft: draftData,
      });
    } catch (error) {
      console.error('Error creating draft:', error);
      res.status(500).json({ error: 'Failed to create draft' });
    }
  })
}));

// Get user's drafts
router.get(
  '/drafts',
  unifiedAuth,
  asyncErrorHandler(async (req, res) => {
    try {
      const userId = req.user.id;
      const { status, limit, orderBy, orderDirection } = req.query;

      let query = admin.firestore()
        .collection('drafts')
        .where('userId', '==', userId);

      // Optional status filter
      if (status) {
        query = query.where('status', '==', status);
      }

      // Ordering
      if (orderBy) {
        query = query.orderBy(orderBy, orderDirection === 'ASC' ? 'asc' : 'desc');
      } else {
        query = query.orderBy('updatedAt', 'desc'); // default
      }

      // Limit
      const draftLimit = parseInt(limit) || 50;
      query = query.limit(draftLimit);

      const snapshot = await query.get();

      const drafts = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      });

      res.json({
        success: true,
        drafts,
      });
    } catch (error) {
      console.error('Error fetching drafts:', error);
      res.status(500).json({ error: 'Failed to fetch drafts' });
    }
  })
}));


// Get specific draft
router.get('/drafts/:id', unifiedAuth, asyncErrorHandler(async (req, res) => {
    try {
        const draftId = req.params.id; // Firestore uses string IDs, no need for parseInt
        const userId = req.user.id;

        // Firestore path: drafts collection, doc(draftId)
        const draftRef = admin.firestore().collection('drafts').doc(draftId);
        const draftSnap = await draftRef.get();

        if (!draftSnap.exists || draftSnap.data().userId !== userId) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        res.json({
            success: true,
            draft: {
                id: draftSnap.id,
                ...draftSnap.data()
            }
        });
    } catch (error) {
        console.error('Error fetching draft:', error);
        res.status(500).json({ error: 'Failed to fetch draft' });
    }
}));

// Update draft
router.put('/drafts/:id', unifiedAuth, validateAssignmentInput, handleValidationErrors, asyncErrorHandler(async (req, res) => {
    try {
        const draftId = req.params.id; // Firestore doc IDs are strings
        const userId = req.user.id;
        const { title, content, prompt, style, tone, targetWordCount, status, createVersion } = req.body;

        const draftRef = admin.firestore().collection('drafts').doc(draftId);
        const draftSnap = await draftRef.get();

        // Verify ownership
        if (!draftSnap.exists || draftSnap.data().userId !== userId) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        const updateData = {};
        if (title !== undefined) updateData.title = title;
        if (content !== undefined) updateData.content = content;
        if (prompt !== undefined) updateData.prompt = prompt;
        if (style !== undefined) updateData.style = style;
        if (tone !== undefined) updateData.tone = tone;
        if (targetWordCount !== undefined) updateData.targetWordCount = targetWordCount;
        if (status !== undefined) updateData.status = status;
        updateData.updatedAt = new Date();

        // Save update
        await draftRef.update(updateData);

        // If versioning is enabled, save a copy into "draftVersions"
        if (createVersion === true) {
            await admin.firestore().collection('draftVersions').add({
                draftId,
                userId,
                versionData: updateData,
                createdAt: new Date()
            });
        }

        res.json({
            success: true,
            draftId,
            updatedFields: updateData
        });
    } catch (error) {
        console.error('Error updating draft:', error);
        res.status(500).json({ error: 'Failed to update draft' });
    }
}));

// Get draft versions
router.get('/drafts/:id/versions', unifiedAuth, asyncErrorHandler(async (req, res) => {
    try {
        const draftId = req.params.id; // Firestore uses string IDs
        const userId = req.user.id;

        // Verify ownership
        const draftRef = admin.firestore().collection('drafts').doc(draftId);
        const draftSnap = await draftRef.get();

        if (!draftSnap.exists || draftSnap.data().userId !== userId) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        // Fetch all versions of this draft
        const versionsSnap = await admin.firestore().collection('draftVersions')
            .where('draftId', '==', draftId)
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .get();

        const versions = versionsSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.json({
            success: true,
            versions
        });
    } catch (error) {
        console.error('Error fetching draft versions:', error);
        res.status(500).json({ error: 'Failed to fetch draft versions' });
    }
}));

// Restore draft version
router.post('/drafts/:id/restore/:version', unifiedAuth, asyncErrorHandler(async (req, res) => {
    try {
        const draftId = req.params.id;  // Firestore uses string IDs
        const versionId = req.params.version; // version doc ID (string)
        const userId = req.user.id;

        // Verify ownership of draft
        const draftRef = admin.firestore().collection('drafts').doc(draftId);
        const draftSnap = await draftRef.get();

        if (!draftSnap.exists || draftSnap.data().userId !== userId) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        // Get the version document
        const versionRef = admin.firestore().collection('draftVersions').doc(versionId);
        const versionSnap = await versionRef.get();

        if (!versionSnap.exists || versionSnap.data().draftId !== draftId || versionSnap.data().userId !== userId) {
            return res.status(404).json({ error: 'Draft version not found' });
        }

        const versionData = versionSnap.data();

        // Restore the version into the main draft
        await draftRef.update({
            title: versionData.title,
            content: versionData.content,
            prompt: versionData.prompt,
            style: versionData.style,
            tone: versionData.tone,
            targetWordCount: versionData.targetWordCount,
            updatedAt: new Date()
        });

        res.json({
            success: true,
            restoredTo: {
                draftId,
                versionId,
                ...versionData
            }
        });
    } catch (error) {
        console.error('Error restoring draft version:', error);
        res.status(500).json({ error: 'Failed to restore draft version' });
    }
}));

// Create auto-save session
router.post('/drafts/:id/autosave-session', unifiedAuth, asyncErrorHandler(async (req, res) => {
    try {
        const draftId = req.params.id; // Firestore doc ID is string
        const userId = req.user.id;

        // Verify ownership
        const draftRef = admin.firestore().collection('drafts').doc(draftId);
        const draftSnap = await draftRef.get();

        if (!draftSnap.exists || draftSnap.data().userId !== userId) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        // Generate a session token (UUID or random string)
        const sessionToken = `autosave_${userId}_${draftId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Store session in a dedicated Firestore collection
        await admin.firestore().collection('draftAutoSaveSessions').doc(sessionToken).set({
            draftId,
            userId,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 mins validity
        });

        res.json({
            success: true,
            sessionToken,
            autoSaveInterval: 60, // e.g. client should auto-save every 60s
        });
    } catch (error) {
        console.error('Error creating auto-save session:', error);
        res.status(500).json({ error: 'Failed to create auto-save session' });
    }
}));

// Auto-save draft content
router.post('/drafts/autosave', unifiedAuth, asyncErrorHandler(async (req, res) => {
    try {
        const { sessionToken, content } = req.body;
        const userId = req.user.id;

        if (!sessionToken || content === undefined) {
            return res.status(400).json({ error: 'Session token and content are required' });
        }

        // Lookup session
        const sessionRef = admin.firestore().collection('draftAutoSaveSessions').doc(sessionToken);
        const sessionSnap = await sessionRef.get();

        if (!sessionSnap.exists) {
            return res.status(404).json({ error: 'Invalid or expired session token' });
        }

        const session = sessionSnap.data();

        // Validate session ownership + expiry
        if (session.userId !== userId) {
            return res.status(403).json({ error: 'Unauthorized session' });
        }
        if (session.expiresAt.toDate() < new Date()) {
            return res.status(410).json({ error: 'Session expired' });
        }

        // Update draft in Firestore
        const draftRef = admin.firestore().collection('drafts').doc(session.draftId);
        await draftRef.update({
            content,
            updatedAt: new Date(),
            status: 'autosaved'
        });

        res.json({
            success: true,
            message: 'Draft autosaved successfully',
            draftId: session.draftId,
            content
        });
    } catch (error) {
        console.error('Error auto-saving draft:', error);
        res.status(500).json({ error: 'Failed to auto-save draft' });
    }
}));

// Delete draft
router.delete('/drafts/:id', unifiedAuth, asyncErrorHandler(async (req, res) => {
    try {
        const draftId = req.params.id; // Firestore uses string IDs, no parseInt
        const userId = req.user.id;

        const draftRef = admin.firestore().collection('drafts').doc(draftId);
        const draftSnap = await draftRef.get();

        if (!draftSnap.exists) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        const draft = draftSnap.data();

        // Verify ownership
        if (draft.userId !== userId) {
            return res.status(403).json({ error: 'Unauthorized to delete this draft' });
        }

        await draftRef.delete();

        res.json({
            success: true,
            message: `Draft ${draftId} deleted successfully`
        });
    } catch (error) {
        console.error('Error deleting draft:', error);
        res.status(500).json({ error: 'Failed to delete draft' });
    }
}));

// Get draft statistics
router.get('/drafts-stats', unifiedAuth, asyncErrorHandler(async (req, res) => {
    try {
        const userId = req.user.id;

        // Fetch all drafts for the user
        const draftsSnap = await admin.firestore().collection('drafts')
            .where('userId', '==', userId)
            .get();

        if (draftsSnap.empty) {
            return res.json({
                success: true,
                statistics: {
                    totalDrafts: 0,
                    completedDrafts: 0,
                    inProgressDrafts: 0,
                    lastUpdated: null
                }
            });
        }

        let totalDrafts = 0;
        let completedDrafts = 0;
        let inProgressDrafts = 0;
        let lastUpdated = null;

        draftsSnap.forEach(doc => {
            const draft = doc.data();
            totalDrafts++;

            if (draft.status === 'completed') {
                completedDrafts++;
            } else {
                inProgressDrafts++;
            }

            if (draft.updatedAt) {
                const updated = draft.updatedAt.toDate ? draft.updatedAt.toDate() : new Date(draft.updatedAt);
                if (!lastUpdated || updated > lastUpdated) {
                    lastUpdated = updated;
                }
            }
        });

        res.json({
            success: true,
            statistics: {
                totalDrafts,
                completedDrafts,
                inProgressDrafts,
                lastUpdated
            }
        });

    } catch (error) {
        console.error('Error fetching draft statistics:', error);
        res.status(500).json({ error: 'Failed to fetch draft statistics' });
    }
}));

// Export content in various formats
router.post('/export', asyncErrorHandler(async (req, res) => {
    try {
        const { content, format, options = {} } = req.body;
        
        if (!content) {
            return res.status(400).json({
                error: 'Content is required for export'
            });
        }
        
        if (!format) {
            return res.status(400).json({
                error: 'Export format is required',
                supportedFormats: contentFormatterInstance.getSupportedFormats()
            });
        }
        
        // Format the content
        const formattedResult = await contentFormatterInstance.formatContent(content, format, options);
        
        // Save to file
        const saveResult = await contentFormatterInstance.saveToFile(formattedResult);
        
        res.json({
            success: true,
            export: {
                filename: saveResult.filename,
                format: saveResult.format,
                size: saveResult.size,
                downloadUrl: `/api/assignments/download/${saveResult.filename}`,
                timestamp: formattedResult.timestamp
            },
            metadata: {
                wordCount: contentFormatterInstance.countWords(content),
                characterCount: content.length,
                exportedAt: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error exporting content:', error);
        res.status(500).json({
            error: 'Failed to export content',
            message: error.message
        });
    }
}));

// Download exported file
router.get('/download/:filename', asyncErrorHandler(async (req, res) => {
    try {
        const { filename } = req.params;
        const filepath = path.join(contentFormatterInstance.exportDirectory, filename);
        
        // Check if file exists
        try {
            await fs.access(filepath);
        } catch (error) {
            return res.status(404).json({
                error: 'File not found',
                filename
            });
        }
        
        // Set appropriate headers
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes = {
            '.txt': 'text/plain',
            '.html': 'text/html',
            '.pdf': 'application/pdf',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };
        
        const mimeType = mimeTypes[ext] || 'application/octet-stream';
        
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Stream the file
        const fileStream = fs.createReadStream(filepath);
        fileStream.pipe(res);
        
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({
            error: 'Failed to download file',
            message: error.message
        });
    }
}));

// Get supported export formats
router.get('/export/formats', asyncErrorHandler(async (req, res) => {
    res.json({
        success: true,
        formats: contentFormatterInstance.getSupportedFormats(),
        descriptions: {
            txt: 'Plain text format with optional formatting',
            html: 'HTML format with CSS styling',
            pdf: 'PDF-ready HTML (requires PDF conversion service)',
            docx: 'Structured data for DOCX generation (requires DOCX library)'
        }
    });
}));

// Preview formatted content (without saving)
router.post('/export/preview', asyncErrorHandler(async (req, res) => {
    try {
        const { content, format, options = {} } = req.body;
        
        if (!content) {
            return res.status(400).json({
                error: 'Content is required for preview'
            });
        }
        
        if (!format) {
            return res.status(400).json({
                error: 'Export format is required',
                supportedFormats: contentFormatterInstance.getSupportedFormats()
            });
        }
        
        // Format the content without saving
        const formattedResult = await contentFormatterInstance.formatContent(content, format, options);
        
        res.json({
            success: true,
            preview: {
                content: formattedResult.content,
                format: formattedResult.format,
                size: formattedResult.size,
                filename: formattedResult.filename
            },
            metadata: {
                wordCount: contentFormatterInstance.countWords(content),
                characterCount: content.length,
                previewedAt: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error previewing content:', error);
        res.status(500).json({
            error: 'Failed to preview content',
            message: error.message
        });
    }
}));

/**
 * Get appropriate HTTP status code for validation error
 * @param {string} errorCode - Validation error code
 * @returns {number} HTTP status code
 */
function getStatusCodeForValidationError(errorCode) {
    const statusCodes = {
        'PROMPT_TOO_LONG': 413, // Payload Too Large
        'OUTPUT_LIMIT_EXCEEDED': 413, // Payload Too Large
        'MONTHLY_WORD_LIMIT_REACHED': 402, // Payment Required
        'MONTHLY_WORD_LIMIT_WOULD_EXCEED': 402, // Payment Required
        'MONTHLY_CREDIT_LIMIT_REACHED': 402, // Payment Required
        'INSUFFICIENT_CREDITS': 402, // Payment Required
        'PLAN_NOT_FOUND': 404, // Not Found
        'INVALID_PLAN': 400, // Bad Request
        'VALIDATION_ERROR': 500, // Internal Server Error
        'MONTHLY_VALIDATION_ERROR': 500, // Internal Server Error
        'CREDIT_VALIDATION_ERROR': 500 // Internal Server Error
    };
    
    return statusCodes[errorCode] || 400; // Default to Bad Request
}

// Usage Tracking Endpoints

/**
 * Get current monthly usage for authenticated user
 */
router.get('/usage/monthly', authenticateToken, asyncErrorHandler(async (req, res) => {
    const userId = req.user.id; // ✅ unified to .id
    const monthlyUsage = await planValidatorInstance.getMonthlyUsage(userId);
    const freemiumLimits = planValidatorInstance.getFreemiumLimits();

    if (!monthlyUsage) {
        return res.status(404).json({ error: 'No usage data found for this month' });
    }

    res.json({
        success: true,
        usage: monthlyUsage,
        limits: freemiumLimits,
        remainingWords: Math.max(0, freemiumLimits.monthlyWordLimit - monthlyUsage.wordsGenerated),
        remainingCredits: Math.max(0, freemiumLimits.monthlyCreditLimit - monthlyUsage.creditsUsed),
        utilizationPercentage: {
            words: Math.round((monthlyUsage.wordsGenerated / freemiumLimits.monthlyWordLimit) * 100),
            credits: Math.round((monthlyUsage.creditsUsed / freemiumLimits.monthlyCreditLimit) * 100)
        },
        nextResetDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1) // start of next month
    });
}));

/**
 * Get usage history for authenticated user
 */
router.get('/usage/history', authenticateToken, asyncErrorHandler(async (req, res) => {
    const userId = req.user.id;
    const months = parseInt(req.query.months) || 6;

    if (months < 1 || months > 12) {
        return res.status(400).json({ error: 'Months parameter must be between 1 and 12' });
    }

    const usageHistory = await planValidatorInstance.getUserUsageHistory(userId, months);

    res.json({
        success: true,
        history: usageHistory || [],
        totalMonths: months
    });
}));

/**
 * Get usage statistics and plan information
 */
router.get('/usage/stats', authenticateToken, asyncErrorHandler(async (req, res) => {
    const userId = req.user.id;

    const monthlyUsage = await planValidatorInstance.getMonthlyUsage(userId);
    const userPlan = await planValidatorInstance.getUserPlan(userId);
    const limits = planValidatorInstance.getFreemiumLimits();

    if (!userPlan) {
        return res.status(404).json({ error: 'User plan not found' });
    }

    const stats = {
        currentMonth: monthlyUsage || { wordsGenerated: 0, creditsUsed: 0, requestCount: 0 },
        plan: {
            type: userPlan.planType,
            name: userPlan.planName || (userPlan.planType.charAt(0).toUpperCase() + userPlan.planType.slice(1)),
            isFreemium: userPlan.planType === 'freemium'
        },
        limits: userPlan.planType === 'freemium' ? limits : null,
        remaining: userPlan.planType === 'freemium' ? {
            words: Math.max(0, limits.monthlyWordLimit - (monthlyUsage?.wordsGenerated || 0)),
            credits: Math.max(0, limits.monthlyCreditLimit - (monthlyUsage?.creditsUsed || 0))
        } : null,
        utilization: userPlan.planType === 'freemium' ? {
            words: Math.round(((monthlyUsage?.wordsGenerated || 0) / limits.monthlyWordLimit) * 100),
            credits: Math.round(((monthlyUsage?.creditsUsed || 0) / limits.monthlyCreditLimit) * 100)
        } : null,
        nextResetDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
        upgradeOptions: planValidatorInstance.getUpgradeOptions(userPlan.planType)
    };

    res.json({ success: true, stats });
}));

/**
 * Service function for Writer tool to generate premium academic assignments
 */
async function generateAssignmentForWriter({
  userId,
  title,
  description,
  wordCount,
  citationStyle = 'APA',
  style = 'Academic',
  tone = 'Formal',
  planType,
  qualityTier = 'premium'
}) {
  // Deduct credits first
  const creditResult = await improvedCreditSystem.deductCreditsAtomic(
    userId,
    wordCount,
    planType,
    "writing",
    qualityTier
  );

  if (!creditResult.success) {
    return { success: false, error: 'Insufficient credits' };
  }

  // Use multi-part generator with refinement + citations
  const generationResult = await multiPartGenerator.generateMultiPartContent({
    userId,
    prompt: `Assignment Title: ${title}\n\nInstructions: ${description}`,
    requestedWordCount: wordCount,
    userPlan: planType,
    style,
    tone,
    subject: title,
    additionalInstructions: description,
    requiresCitations: true,
    citationStyle,
    qualityTier,
    enableRefinement: qualityTier === 'premium'
  });

  // Run final detection (AI/Plagiarism)
  const finalDetectionResults = await finalDetectionService.processFinalDetection(
    generationResult.content,
    generationResult.chunkDetectionResults || [],
    {
      contentId: generationResult.contentId,
      userId,
      isMultiPart: generationResult.chunksGenerated > 1,
      generationMethod: 'multi-part'
    }
  );

  return {
    success: true,
    content: generationResult.content,
    wordCount: generationResult.wordCount,
    citations: citationStyle,
    quality: qualityTier,
    detection: finalDetectionResults,
    creditsUsed: creditResult.creditsDeducted,
    remainingCredits: creditResult.newBalance
  };
}

module.exports = {
  router,
  generateAssignmentForWriter
};
