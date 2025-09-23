const express = require('express');
const multer = require('multer');
const path = require('path');
const FileProcessingService = require('../services/fileProcessingService');
const llmService = require('../services/llmService');
const ContentDatabase = require('../services/contentDatabase');
const MultiPartGenerator = require('../services/multiPartGenerator');
const { unifiedAuth } = require('../middleware/unifiedAuth');
const { asyncErrorHandler } = require('../middleware/errorHandler');
const { validateWriterInput, handleValidationErrors } = require('../middleware/validation');
const ImprovedCreditSystem = require('../services/improvedCreditSystem');
const { generateAssignmentForWriter } = require('./assignments');

const PlanValidator = require('../services/planValidator');
const router = express.Router();
const fileProcessingService = new FileProcessingService();
const contentDatabase = new ContentDatabase();
const multiPartGenerator = new MultiPartGenerator();
const creditSystem = new ImprovedCreditSystem();
const planValidator = new PlanValidator();

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store files in memory for processing
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 5 // Maximum 5 files
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.docx', '.txt'];
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${ext}. Allowed types: PDF, DOCX, TXT`), false);
        }
    }
});

/**
 * Assignment generation function (extracted from assignments.js)
 */
const generateAssignmentContent = async (title, description, wordCount, citationStyle, style = 'Academic', tone = 'Formal') => {
    const styleTemplates = {
        'Academic': {
            introduction: 'This scholarly examination explores',
            transition: 'Furthermore, research indicates that',
            conclusion: 'In conclusion, the evidence demonstrates'
        },
        'Business': {
            introduction: 'This business analysis examines',
            transition: 'Market data suggests that',
            conclusion: 'The strategic implications indicate'
        },
        'Creative': {
            introduction: 'Imagine a world where',
            transition: 'As we delve deeper into this narrative',
            conclusion: 'The story ultimately reveals'
        }
    };
    
    const selectedStyle = styleTemplates[style] || styleTemplates['Academic'];
    
    // Generate actual content using LLM service
    const prompt = `Write a ${wordCount}-word ${style.toLowerCase()} ${tone.toLowerCase()} assignment on "${title}". ${description ? `Instructions: ${description}` : ''} Use ${citationStyle} citation style.`;
    
    try {
        const generatedContent = await llmService.generateContent(prompt, {
            maxTokens: Math.ceil(wordCount * 1.5), // Approximate token count
            temperature: 0.7,
            style: style,
            tone: tone
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
3. Third perspective on the topic
4. Fourth consideration and implications

## Analysis

The research indicates several important findings that contribute to our understanding of this topic. These insights are particularly relevant in the current academic discourse.

## Conclusion

In conclusion, this analysis of "${title}" reveals significant insights that contribute to the broader understanding of the subject matter. The implications of these findings extend beyond the immediate scope of this assignment.

## References

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

/**
 * POST /api/writer/generate
 * Generate content from text prompt or assignment
 */
router.post(
  "/generate",
  unifiedAuth,
  validateWriterInput,
  handleValidationErrors,
  asyncErrorHandler(async (req, res) => {
    try {
      const {
        prompt,
        style = "Academic",
        tone = "Formal",
        wordCount = 500,
        qualityTier = "standard",
        contentType = "general", // 'general' or 'assignment'
        assignmentTitle,
        citationStyle = "APA",
      } = req.body;

      const userId = req.user.userId;

      // 🔹 Input checks
      if (!prompt || prompt.trim().length === 0) {
        return res.status(400).json({ success: false, error: "Prompt is required" });
      }
      if (wordCount < 100 || wordCount > 2000) {
        return res
          .status(400)
          .json({ success: false, error: "Word count must be between 100 and 2000" });
      }
      if (contentType === "assignment" && (!assignmentTitle || assignmentTitle.trim().length === 0)) {
        return res.status(400).json({
          success: false,
          error: "Assignment title is required for assignment generation",
        });
      }

      // 🔹 Validate user plan
      const planValidation = await planValidator.validateUserPlan(userId, {
        toolType: "writing",
        requestType: "generation",
      });
      if (!planValidation.isValid) {
        return res.status(403).json({
          success: false,
          error: planValidation.error || "Plan validation failed",
        });
      }
      const planType = planValidation.userPlan.planType;

      /**
       * FLOW 1: Assignment + Premium → Delegate to assignments.js
       */
      if (contentType === "assignment" && qualityTier === "premium") {
        console.log("Delegating to assignments.js (premium academic assignment)");

        const assignmentResult = await generateAssignmentForWriter({
          userId,
          title: assignmentTitle,
          description: prompt,
          wordCount,
          citationStyle,
          style,
          tone,
          planType,
          qualityTier,
        });

        return res.json(assignmentResult);
      }

      /**
       * FLOW 2 & 3: Other cases (General + Standard/Premium OR Assignment + Standard)
       * Handle fully inside writer.js
       */

      // 🔹 Credit calculation
      let baseCreditsNeeded = creditSystem.calculateRequiredCredits(wordCount, "writing");
      const creditsNeeded = qualityTier === "premium" ? baseCreditsNeeded * 2 : baseCreditsNeeded;

      // 🔹 Deduct credits
      const creditResult = await creditSystem.deductCreditsAtomic(
        userId,
        wordCount,
        planType,
        "writing",
        qualityTier
      );
      if (!creditResult.success) {
        return res.status(402).json({
          error: "Insufficient credits",
          details: creditResult,
        });
      }

      // 🔹 Decide generation strategy
      let result;
      let contentSource = "new_generation";
      const useMultiPart =
        wordCount > 800 || (planValidation.userPlan.planType !== "freemium" && wordCount > 500);
      const enableRefinement = qualityTier === "premium";

      if (useMultiPart) {
        // Multi-part generation
        result = await multiPartGenerator.generateMultiPartContent({
          userId,
          prompt: contentType === "assignment" ? `Assignment: ${assignmentTitle}\n\n${prompt}` : prompt,
          requestedWordCount: wordCount,
          userPlan: planType,
          style,
          tone,
          subject: assignmentTitle || "",
          additionalInstructions:
            contentType === "assignment"
              ? `Generate academic assignment with ${citationStyle} citations`
              : "",
          requiresCitations: contentType === "assignment",
          citationStyle,
          qualityTier,
          enableRefinement,
        });

        contentSource = result.usedSimilarContent
          ? "multipart_optimized"
          : contentType === "assignment"
          ? "assignment_multipart_new"
          : "multipart_new";
      } else {
        // Single-shot generation
        result = await llmService.generateContent(
          prompt,
          style,
          tone,
          wordCount,
          qualityTier
        );
      }

      // 🔹 Store result
      if (result && result.content) {
        await contentDatabase.storeContent(userId, prompt, result.content, {
          style,
          tone,
          generationTime: result.generationTime,
          source: contentSource,
          wordCount: wordCount,
        });
      }

      // 🔹 Response
      return res.json({
        success: true,
        content: result.content,
        metadata: {
          source: result.source || "generation",
          generationTime: result.generationTime,
          contentSource,
          style,
          tone,
          wordCount: result.wordCount || wordCount,
          creditsUsed: creditsNeeded,
          remainingCredits: creditResult.newBalance,
          qualityTier,
          contentType,
          assignmentTitle: contentType === "assignment" ? assignmentTitle : null,
          citationStyle: contentType === "assignment" ? citationStyle : null,
          isMultiPart: useMultiPart,
          refinementCycles: result.refinementCycles || 0,
        },
      });
           
        } catch (generationError) {
            console.error('Content generation failed, rolling back credits:', generationError);
            
            // Rollback credits on generation failure
            try {
                await creditSystem.rollbackTransaction(
                    userId,
                    creditsNeeded,
                    planValidation.userPlan.planType,
                    'writing_rollback'
                );
            } catch (rollbackError) {
                console.error('Credit rollback failed:', rollbackError);
            }
            
            return res.status(500).json({
                success: false,
                error: 'Content generation failed',
                details: generationError.message
            });
        }
        
    } catch (error) {
        console.error('Error in writer generate endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
}));

/**
 * POST /api/writer/upload-and-generate
 * Upload files and generate content based on file contents
 */
router.post('/upload-and-generate', unifiedAuth, upload.array('files', 10), validateWriterInput, handleValidationErrors, asyncErrorHandler(async (req, res) => {
    try {
        const { additionalPrompt = '', style = 'Academic', tone = 'Formal', wordCount = 500, qualityTier = 'standard' } = req.body;
        const files = req.files;
        const userId = req.user.userId;
        
        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files uploaded'
            });
        }
        
        if (wordCount < 100 || wordCount > 2000) {
            return res.status(400).json({
                success: false,
                error: 'Word count must be between 100 and 2000'
            });
        }
        
        // Validate user plan and calculate credits
        const planValidation = await planValidator.validateUserPlan(userId, {
            toolType: 'writing',
            requestType: 'generation'
        });
        
        if (!planValidation.isValid) {
            return res.status(403).json({
                success: false,
                error: planValidation.error || 'Plan validation failed'
            });
        }
        
        // Calculate credits needed based on quality tier
        // Standard: 1 credit per 3 words, Premium: 2x credits (2 credits per 3 words)
        let baseCreditsNeeded = creditSystem.calculateRequiredCredits(wordCount, 'writing');
        const creditsNeeded = qualityTier === 'premium' ? baseCreditsNeeded * 2 : baseCreditsNeeded;

        const planType = planValidation.userPlan.planType;
        
        // Deduct credits via ImprovedCreditSystem
        const creditResult = await creditSystem.deductCreditsAtomic(
        userId,
        wordCount,
        planType,
        "writing"
       );

       if (!creditResult.success) {
       return res.status(402).json({
        error: "Insufficient credits",
        details: creditResult
      });
    }

    const content = await multiPartGenerator.generate(userId, extracted, wordCount, style);
    const validation = contentValidator.validate(content, wordCount);

    const historyId = await contentHistory.save(userId, {
      prompt: extracted.slice(0, 100) + "...",
      content,
      style,
      wordCount,
      validation,
      creditsUsed: creditResult.creditsDeducted
    });

    await logActivity(userId, "Writer: Generated from upload", {
      wordCount,
      creditsUsed: creditResult.creditsDeducted
    });

    res.json({ id: historyId, content, validation });
  } catch (err) {
    console.error("Upload generate error:", err);
    res.status(500).json({ error: "Failed to generate from file" });
  }
});
        }
        
        try {
        
        // Process files and generate content
        const result = await fileProcessingService.processFilesAndGenerate(
            files,
            additionalPrompt,
            style,
            tone
        );
        
            if (!result.success) {
                // Rollback credits on file processing failure
                try {
                    await creditSystem.rollbackTransaction(
                        userId,
                        creditsNeeded,
                        planValidation.userPlan.planType,
                        'writing_rollback'
                    );
                } catch (rollbackError) {
                    console.error('Credit rollback failed:', rollbackError);
                }
                return res.status(400).json(result);
            }
            
            let llmResult;
            let contentSource = 'new_generation';
            
            // Determine if multi-part generation is needed for file-based content
            const useMultiPart = wordCount > 800 || 
                               (planValidation.userPlan.planType !== 'freemium' && wordCount > 500);
            
            // Enable 2-loop refinement system for premium quality tier
            const enableRefinement = qualityTier === 'premium';
            
            if (useMultiPart) {
                console.log(`Using multi-part generation for file-based content: ${wordCount} words`);
                
                // Use MultiPartGenerator for chunk-based generation with iterative detection
                llmResult = await multiPartGenerator.generateMultiPartContent({
                    userId,
                    prompt: result.prompt,
                    requestedWordCount: wordCount,
                    userPlan: planValidation.userPlan.planType,
                    style,
                    tone,
                    subject: req.body.subject || '',
                    additionalInstructions: additionalPrompt,
                    requiresCitations: req.body.requiresCitations || false,
                    citationStyle: req.body.citationStyle || 'apa',
                    qualityTier: qualityTier,
                    enableRefinement: enableRefinement
                });
                
                contentSource = llmResult.usedSimilarContent ? 'multipart_optimized_files' : 'multipart_new_files';
            } else {
                // Use traditional single-generation for smaller file-based content
                console.log(`Using single generation for file-based content: ${wordCount} words`);
                
                // Check for similar content in database (80%+ matching) using the generated prompt
                const similarContent = await contentDatabase.findSimilarContent(result.prompt, style, tone, wordCount);
                
                if (similarContent && similarContent.length > 0) {
                    // Use existing similar content as base for polishing
                    console.log(`Found ${similarContent.length} similar content matches for file-based prompt`);
                    const bestMatch = similarContent[0]; // Highest similarity score
                    
                    // Get content for polishing and refinement
                    const polishingContent = await contentDatabase.getContentForPolishing(bestMatch.contentId, wordCount);
                    
                    if (polishingContent && polishingContent.sections) {
                        // Use existing content as base, polish to match new requirements
                        llmResult = await llmService.polishExistingContent(
                            polishingContent.sections,
                            result.prompt,
                            style,
                            tone,
                            wordCount,
                            qualityTier
                        );
                        contentSource = 'optimized_existing';
                        
                        // Update access statistics for the reused content
                        await contentDatabase.updateAccessStatistics([bestMatch.contentId]);
                    } else {
                        // Fallback to new generation if polishing fails
                        llmResult = await llmService.generateContent(
                            result.prompt,
                            style,
                            tone,
                            wordCount,
                            qualityTier
                        );
                    }
                } else {
                    // No similar content found, generate new content
                    console.log('No similar content found for file-based prompt, generating new content');
                    llmResult = await llmService.generateContent(
                        result.prompt,
                        style,
                        tone,
                        wordCount,
                        qualityTier
                    );
                }
                
                // Store the new/polished content in database for future optimization
                if (llmResult && llmResult.content) {
                    await contentDatabase.storeContent(userId, result.prompt, llmResult.content, {
                        style,
                        tone,
                        generationTime: llmResult.generationTime,
                        source: contentSource,
                        wordCount: wordCount,
                        basedOnFiles: true,
                        fileCount: files.length
                    });
                }
            }
            
            // Prepare response with multi-part metadata if applicable
            const response = {
                success: true,
                content: llmResult.content,
                extractedContent: result.extractedContent,
                generatedPrompt: result.prompt,
                metadata: {
                    ...result.metadata,
                    llmSource: llmResult.source,
                    generationTime: llmResult.generationTime,
                    fallbackUsed: llmResult.fallbackUsed,
                    contentSource: contentSource,
                    creditsUsed: creditsNeeded,
                    remainingCredits: creditResult.newBalance,
                    qualityTier: qualityTier,
                    enabledRefinement: enableRefinement,
                    basedOnFiles: true,
                    fileCount: files.length
                }
            };
            
            if (useMultiPart) {
                // Add multi-part specific metadata
                response.metadata.isMultiPart = true;
                response.metadata.chunksGenerated = llmResult.chunksGenerated || 0;
                response.metadata.refinementCycles = llmResult.refinementCycles || 0;
                response.metadata.contentId = llmResult.contentId;
                response.metadata.similarContentFound = llmResult.usedSimilarContent || false;
                response.metadata.requiresCitations = llmResult.citationData?.requiresCitations || false;
                response.metadata.citationCount = llmResult.citationData?.citationCount || 0;
                response.metadata.citationStyle = llmResult.citationData?.style || null;
                response.metadata.bibliography = llmResult.citationData?.bibliography || [];
                response.metadata.inTextCitations = llmResult.citationData?.inTextCitations || [];
                // Final detection results
                response.metadata.originalityScore = llmResult.finalDetectionResults?.originalityScore || null;
                response.metadata.aiDetectionScore = llmResult.finalDetectionResults?.aiDetectionScore || null;
                response.metadata.plagiarismScore = llmResult.finalDetectionResults?.plagiarismScore || null;
                response.metadata.qualityScore = llmResult.finalDetectionResults?.qualityScore || null;
                response.metadata.requiresReview = llmResult.finalDetectionResults?.requiresReview || false;
                response.metadata.isAcceptable = llmResult.finalDetectionResults?.isAcceptable || true;
                response.metadata.detectionConfidence = llmResult.finalDetectionResults?.confidence || null;
                response.metadata.detectionRecommendations = llmResult.finalDetectionResults?.recommendations || [];
            } else {
                // Add single-generation metadata
                response.metadata.isMultiPart = false;
                response.metadata.similarContentFound = contentSource === 'optimized_existing';
            }
            
            res.json(response);
            
        } catch (generationError) {
            console.error('Content generation failed, rolling back credits:', generationError);
            
            // Rollback credits on generation failure
            try {
                await creditSystem.rollbackTransaction(
                    userId,
                    creditsNeeded,
                    planValidation.userPlan.planType,
                    'writing_rollback'
                );
            } catch (rollbackError) {
                console.error('Credit rollback failed:', rollbackError);
            }
            
            return res.status(500).json({
                success: false,
                error: 'Content generation failed',
                details: generationError.message
            });
        }
        
    } catch (error) {
        console.error('Error in upload-and-generate endpoint:', error);
        
        // Handle multer errors
        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    success: false,
                    error: 'File too large',
                    details: 'Maximum file size is 10MB'
                });
            }
            if (error.code === 'LIMIT_FILE_COUNT') {
                return res.status(400).json({
                    success: false,
                    error: 'Too many files',
                    details: 'Maximum 5 files allowed'
                });
            }
        }
        
        res.status(500).json({
            success: false,
            error: 'File processing and content generation failed',
            details: error.message
        });
    }
}));

/**
 * GET /api/writer/supported-formats
 * Get list of supported file formats
 */
router.get('/supported-formats', (req, res) => {
    res.json({
        success: true,
        formats: [
            {
                extension: '.pdf',
                description: 'Portable Document Format',
                maxSize: '10MB'
            },
            {
                extension: '.docx',
                description: 'Microsoft Word Document',
                maxSize: '10MB'
            },
            {
                extension: '.txt',
                description: 'Plain Text File',
                maxSize: '10MB'
            }
        ],
        limits: {
            maxFiles: 5,
            maxFileSize: '10MB',
            totalMaxSize: '50MB'
        }
    });
});

/**
 * POST /api/writer/validate-files
 * Validate files before upload
 */
router.post('/validate-files', unifiedAuth, upload.array('files', 5), asyncErrorHandler(async (req, res) => {
    try {
        const files = req.files;
        
        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files provided for validation'
            });
        }
        
        const validation = fileProcessingService.validateFiles(files);
        
        res.json({
            success: validation.valid,
            valid: validation.valid,
            errors: validation.errors || [],
            fileInfo: files.map(file => ({
                name: file.originalname,
                size: file.size,
                type: path.extname(file.originalname).toLowerCase(),
                sizeFormatted: `${(file.size / 1024 / 1024).toFixed(2)} MB`
            }))
        });
        
    } catch (error) {
        console.error('Error validating files:', error);
        res.status(500).json({
            success: false,
            error: 'File validation failed',
            details: error.message
        });
    }
}));

/**
 * Error handling middleware for multer
 */
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large',
                details: 'Maximum file size is 10MB'
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                error: 'Too many files',
                details: 'Maximum 5 files allowed'
            });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                error: 'Unexpected file field',
                details: 'Please use the correct file field name'
            });
        }
    }
    
    if (error.message.includes('Unsupported file type')) {
        return res.status(400).json({
            success: false,
            error: 'Unsupported file type',
            details: error.message
        });
    }
    
    next(error);
});

/**
 * POST /api/writer/download
 * Download content as .docx file
 */
router.post('/download', asyncErrorHandler(async (req, res) => {
    try {
        const { title, content, format = 'docx' } = req.body;
        
        if (!title || !content) {
            return res.status(400).json({
                success: false,
                error: 'Title and content are required'
            });
        }
        
        if (format === 'docx') {
            // Create a simple HTML structure for docx conversion
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>${title}</title>
                    <style>
                        body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.5; margin: 1in; }
                        h1 { font-size: 16pt; font-weight: bold; text-align: center; margin-bottom: 1em; }
                        p { margin-bottom: 1em; text-align: justify; }
                        .citation { font-size: 10pt; vertical-align: super; }
                    </style>
                </head>
                <body>
                    <h1>${title}</h1>
                    <div>${content.replace(/\n/g, '</p><p>')}</div>
                </body>
                </html>
            `;
            
            // Set headers for docx download
            const filename = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.docx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            
            // For now, we'll send the HTML content as a simple text file with .docx extension
            // In a production environment, you'd want to use a library like docx or html-docx-js
            res.send(htmlContent);
        } else {
            // Default to text format
            const filename = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(content);
        }
        
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate download',
            details: error.message
        });
    }
}));

module.exports = router;
