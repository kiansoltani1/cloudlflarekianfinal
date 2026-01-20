/**
 * Feedback Pulse - Cloudflare Worker with AI-powered feedback classification
 */

interface FeedbackSubmission {
	feedback: string;
}

interface ClassificationResult {
	escalation_level: 'RED' | 'YELLOW' | 'GREEN';
	explanation: string;
	easy_win: boolean;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type',
				},
			});
		}

		// Handle feedback submission
		if (path === '/api/feedback' && request.method === 'POST') {
			return handleFeedbackSubmission(request, env);
		}

		// Handle dashboard
		if (path === '/' && request.method === 'GET') {
			return handleDashboard(request, env);
		}

		// 404 for other routes
		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;

async function handleFeedbackSubmission(request: Request, env: Env): Promise<Response> {
	try {
		const body: FeedbackSubmission = await request.json();
		const feedbackText = body.feedback?.trim();

		if (!feedbackText) {
			return jsonResponse({ error: 'Feedback text is required' }, 400);
		}

		// Classify feedback using Workers AI
		const classification = await classifyFeedback(feedbackText, env);

		// Store in D1
		const result = await env.feedback_db
			.prepare(
				`INSERT INTO feedback (feedback_text, escalation_level, explanation, easy_win)
				 VALUES (?, ?, ?, ?)`
			)
			.bind(
				feedbackText,
				classification.escalation_level,
				classification.explanation,
				classification.easy_win ? 1 : 0
			)
			.run();

		return jsonResponse({
			success: true,
			id: result.meta.last_row_id,
			classification,
		});
	} catch (error) {
		console.error('Error processing feedback:', error);
		return jsonResponse(
			{ error: 'Failed to process feedback', details: error instanceof Error ? error.message : 'Unknown error' },
			500
		);
	}
}

function mockClassifyFeedback(feedbackText: string): ClassificationResult {
	// Mock classifier for local development using keyword matching
	const text = feedbackText.toLowerCase();
	
	// RED indicators: critical, blocking, security, payment, revenue, outage, broken, cannot access
	const redKeywords = [
		'cannot access', 'broken', 'down', 'outage', 'critical', 'security', 'vulnerability',
		'payment', 'transaction', 'revenue', 'data loss', 'exposed', 'authentication failure',
		'threatening to cancel', 'major issues', 'completely broken', 'completely down'
	];
	
	// GREEN indicators: praise, positive, love, great, helpful, nice, suggestion (minor)
	const greenKeywords = [
		'love', 'great', 'helpful', 'nice', 'good', 'excellent', 'awesome', 'wonderful',
		'minor suggestion', 'could we add', 'would love', 'maybe we could'
	];
	
	// Easy win indicators: typo, spelling, small change, quick fix
	const easyWinKeywords = [
		'typo', 'spelling', 'grammar', 'recieve', 'recieved', 'quick fix', 'small change',
		'minor', 'small issue'
	];
	
	// Check for RED
	const isRed = redKeywords.some(keyword => text.includes(keyword));
	
	// Check for GREEN (but not if it's RED)
	const isGreen = !isRed && greenKeywords.some(keyword => text.includes(keyword));
	
	// Check for easy win
	const isEasyWin = easyWinKeywords.some(keyword => text.includes(keyword));
	
	let escalation_level: 'RED' | 'YELLOW' | 'GREEN';
	let explanation: string;
	
	if (isRed) {
		escalation_level = 'RED';
		explanation = 'Classified as RED due to critical issue indicators (system outage, security concern, or revenue impact).';
	} else if (isGreen) {
		escalation_level = 'GREEN';
		explanation = 'Classified as GREEN due to positive feedback or low-priority suggestion.';
	} else {
		escalation_level = 'YELLOW';
		explanation = 'Classified as YELLOW - important but non-blocking issue or feature request.';
	}
	
	return {
		escalation_level,
		explanation,
		easy_win: isEasyWin,
	};
}

async function classifyFeedback(feedbackText: string, env: Env): Promise<ClassificationResult> {
	// Try to use Workers AI if available (remote mode)
	// Fall back to mock classifier for local mode
	
	try {
		// Check if AI binding is available and functional
		if (!env.AI) {
			console.log('AI binding not available, using mock classifier');
			return mockClassifyFeedback(feedbackText);
		}

		console.log('Calling Workers AI...');
		const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
			messages: [
				{
					role: 'system',
					content: 'You are a helpful assistant that classifies feedback. Always respond with valid JSON only.',
				},
				{
					role: 'user',
					content: `You are a feedback classification system. Analyze the following feedback and classify it into one of three escalation levels:

- RED: Critical issues requiring immediate attention (bugs, security issues, data loss, service outages, severe user frustration)
- YELLOW: Important issues that should be addressed soon (feature requests, moderate bugs, usability concerns)
- GREEN: Low priority items (nice-to-have features, minor suggestions, positive feedback)

Also determine if this is an "easy win" - something that can be fixed or implemented quickly with minimal effort.

Feedback: "${feedbackText}"

Respond with a JSON object in this exact format:
{
  "escalation_level": "RED" | "YELLOW" | "GREEN",
  "explanation": "A one-sentence explanation of why this classification was chosen",
  "easy_win": true | false}`,
				},
			],
			max_tokens: 200,
		});

		console.log('AI response received:', JSON.stringify(response).substring(0, 200));
		
		// Handle different response formats
		let responseText = '';
		if (typeof response === 'string') {
			responseText = response;
		} else if (response && typeof response === 'object') {
			responseText = (response as any).response || (response as any).text || JSON.stringify(response);
		}
		
		if (!responseText) {
			throw new Error('Empty AI response');
		}
		
		// Extract JSON from the response (AI might add extra text)
		const jsonMatch = responseText.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			throw new Error(`No JSON found in AI response: ${responseText.substring(0, 100)}`);
		}

		const parsed = JSON.parse(jsonMatch[0]) as ClassificationResult;

		// Validate and normalize the response
		if (!['RED', 'YELLOW', 'GREEN'].includes(parsed.escalation_level)) {
			throw new Error(`Invalid escalation level: ${parsed.escalation_level}`);
		}

		return {
			escalation_level: parsed.escalation_level as 'RED' | 'YELLOW' | 'GREEN',
			explanation: parsed.explanation || 'No explanation provided',
			easy_win: Boolean(parsed.easy_win),
		};
	} catch (error) {
		console.log('AI classification unavailable, using mock classifier:', error instanceof Error ? error.message : 'Unknown error');
		// Use mock classifier if AI is not available (local mode)
		return mockClassifyFeedback(feedbackText);
	}
}

async function handleDashboard(request: Request, env: Env): Promise<Response> {
	try {
		// Fetch all feedback grouped by escalation level
		const feedback = await env.feedback_db
			.prepare(
				`SELECT id, feedback_text, escalation_level, explanation, easy_win, created_at
				 FROM feedback
				 ORDER BY created_at DESC`
			)
			.all<{
				id: number;
				feedback_text: string;
				escalation_level: 'RED' | 'YELLOW' | 'GREEN';
				explanation: string;
				easy_win: number;
				created_at: string;
			}>();

		const feedbackItems = feedback.results || [];

		// Group by escalation level
		const grouped = {
			RED: feedbackItems.filter((f) => f.escalation_level === 'RED'),
			YELLOW: feedbackItems.filter((f) => f.escalation_level === 'YELLOW'),
			GREEN: feedbackItems.filter((f) => f.escalation_level === 'GREEN'),
		};

		const html = generateDashboardHTML(grouped);
		return new Response(html, {
			headers: {
				'Content-Type': 'text/html',
			},
		});
	} catch (error) {
		console.error('Error loading dashboard:', error);
		return new Response('Error loading dashboard', { status: 500 });
	}
}

function generateDashboardHTML(grouped: {
	RED: Array<{
		id: number;
		feedback_text: string;
		escalation_level: 'RED' | 'YELLOW' | 'GREEN';
		explanation: string;
		easy_win: number;
		created_at: string;
	}>;
	YELLOW: Array<{
		id: number;
		feedback_text: string;
		escalation_level: 'RED' | 'YELLOW' | 'GREEN';
		explanation: string;
		easy_win: number;
		created_at: string;
	}>;
	GREEN: Array<{
		id: number;
		feedback_text: string;
		escalation_level: 'RED' | 'YELLOW' | 'GREEN';
		explanation: string;
		easy_win: number;
		created_at: string;
	}>;
}): string {
	const renderFeedbackCard = (
		item: {
			id: number;
			feedback_text: string;
			escalation_level: 'RED' | 'YELLOW' | 'GREEN';
			explanation: string;
			easy_win: number;
			created_at: string;
		},
		level: 'RED' | 'YELLOW' | 'GREEN'
	) => {
		const isEasyWin = item.easy_win === 1;
		const levelColors = {
			RED: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
			YELLOW: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
			GREEN: { bg: '#d1fae5', border: '#10b981', text: '#065f46' },
		};
		const colors = levelColors[level];
		const date = new Date(item.created_at).toLocaleString();

		return `
			<div class="feedback-card ${isEasyWin ? 'easy-win' : ''}" style="background: ${colors.bg}; border-left: 4px solid ${colors.border};">
				${isEasyWin ? '<div class="easy-win-badge">🎯 Easy Win</div>' : ''}
				<div class="feedback-text">${escapeHtml(item.feedback_text)}</div>
				<div class="explanation" style="color: ${colors.text};">${escapeHtml(item.explanation)}</div>
				<div class="meta">
					<span class="id">#${item.id}</span>
					<span class="date">${escapeHtml(date)}</span>
				</div>
			</div>
		`;
	};

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Feedback Pulse Dashboard</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
			background: #f5f5f5;
			color: #333;
			line-height: 1.6;
		}
		.header {
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			color: white;
			padding: 2rem;
			box-shadow: 0 2px 4px rgba(0,0,0,0.1);
		}
		.header h1 {
			font-size: 2rem;
			margin-bottom: 0.5rem;
		}
		.header p {
			opacity: 0.9;
		}
		.container {
			max-width: 1400px;
			margin: 0 auto;
			padding: 2rem;
		}
		.stats {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
			gap: 1rem;
			margin-bottom: 2rem;
		}
		.stat-card {
			background: white;
			padding: 1.5rem;
			border-radius: 8px;
			box-shadow: 0 2px 4px rgba(0,0,0,0.1);
		}
		.stat-card h3 {
			font-size: 0.875rem;
			text-transform: uppercase;
			color: #666;
			margin-bottom: 0.5rem;
		}
		.stat-card .number {
			font-size: 2rem;
			font-weight: bold;
		}
		.stat-card.red .number { color: #ef4444; }
		.stat-card.yellow .number { color: #f59e0b; }
		.stat-card.green .number { color: #10b981; }
		.section {
			margin-bottom: 3rem;
		}
		.section-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			margin-bottom: 1rem;
		}
		.section-title {
			font-size: 1.5rem;
			font-weight: bold;
			display: flex;
			align-items: center;
			gap: 0.5rem;
		}
		.section-title.red { color: #ef4444; }
		.section-title.yellow { color: #f59e0b; }
		.section-title.green { color: #10b981; }
		.count-badge {
			background: #e5e7eb;
			padding: 0.25rem 0.75rem;
			border-radius: 12px;
			font-size: 0.875rem;
			font-weight: normal;
		}
		.feedback-grid {
			display: grid;
			gap: 1rem;
		}
		.feedback-card {
			background: white;
			padding: 1.5rem;
			border-radius: 8px;
			box-shadow: 0 2px 4px rgba(0,0,0,0.1);
			position: relative;
			transition: transform 0.2s, box-shadow 0.2s;
		}
		.feedback-card:hover {
			transform: translateY(-2px);
			box-shadow: 0 4px 8px rgba(0,0,0,0.15);
		}
		.feedback-card.easy-win {
			border: 2px solid #10b981;
			box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
		}
		.easy-win-badge {
			position: absolute;
			top: 1rem;
			right: 1rem;
			background: #10b981;
			color: white;
			padding: 0.25rem 0.75rem;
			border-radius: 12px;
			font-size: 0.75rem;
			font-weight: bold;
		}
		.feedback-text {
			font-size: 1rem;
			margin-bottom: 0.75rem;
			font-weight: 500;
		}
		.explanation {
			font-size: 0.875rem;
			margin-bottom: 1rem;
			font-style: italic;
		}
		.meta {
			display: flex;
			justify-content: space-between;
			font-size: 0.75rem;
			color: #666;
		}
		.empty-state {
			text-align: center;
			padding: 3rem;
			color: #999;
			background: white;
			border-radius: 8px;
		}
		@media (max-width: 768px) {
			.container {
				padding: 1rem;
			}
			.stats {
				grid-template-columns: 1fr;
			}
		}
	</style>
</head>
<body>
	<div class="header">
		<h1>📊 Feedback Pulse Dashboard</h1>
		<p>AI-powered feedback classification and prioritization</p>
	</div>
	<div class="container">
		<div class="stats">
			<div class="stat-card red">
				<h3>Critical (RED)</h3>
				<div class="number">${grouped.RED.length}</div>
			</div>
			<div class="stat-card yellow">
				<h3>Important (YELLOW)</h3>
				<div class="number">${grouped.YELLOW.length}</div>
			</div>
			<div class="stat-card green">
				<h3>Low Priority (GREEN)</h3>
				<div class="number">${grouped.GREEN.length}</div>
			</div>
			<div class="stat-card">
				<h3>Easy Wins</h3>
				<div class="number" style="color: #10b981;">
					${[...grouped.RED, ...grouped.YELLOW, ...grouped.GREEN].filter((f) => f.easy_win === 1).length}
				</div>
			</div>
		</div>

		<div class="section">
			<div class="section-header">
				<h2 class="section-title red">🔴 Critical Issues</h2>
				<span class="count-badge">${grouped.RED.length} items</span>
			</div>
			<div class="feedback-grid">
				${grouped.RED.length > 0 ? grouped.RED.map((item) => renderFeedbackCard(item, 'RED')).join('') : '<div class="empty-state">No critical issues</div>'}
			</div>
		</div>

		<div class="section">
			<div class="section-header">
				<h2 class="section-title yellow">🟡 Important Issues</h2>
				<span class="count-badge">${grouped.YELLOW.length} items</span>
			</div>
			<div class="feedback-grid">
				${grouped.YELLOW.length > 0 ? grouped.YELLOW.map((item) => renderFeedbackCard(item, 'YELLOW')).join('') : '<div class="empty-state">No important issues</div>'}
			</div>
		</div>

		<div class="section">
			<div class="section-header">
				<h2 class="section-title green">🟢 Low Priority</h2>
				<span class="count-badge">${grouped.GREEN.length} items</span>
			</div>
			<div class="feedback-grid">
				${grouped.GREEN.length > 0 ? grouped.GREEN.map((item) => renderFeedbackCard(item, 'GREEN')).join('') : '<div class="empty-state">No low priority items</div>'}
			</div>
		</div>
	</div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
		},
	});
}
