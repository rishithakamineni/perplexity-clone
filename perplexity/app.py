import os
import flask
from flask import Flask, request, jsonify, render_template, send_from_directory, session
from flask_cors import CORS
import google.generativeai as genai
from PyPDF2 import PdfReader
import requests
from bs4 import BeautifulSoup
import wikipedia
from duckduckgo_search import DDGS
import re
import json
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from cachetools import TTLCache
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
# Initialize rate limiter
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

# Setup CORS for frontend on localhost:3000 specifically
CORS(app, resources={r"/*": {"origins": ["http://localhost:3000", "http://localhost:8000"]}})
app.secret_key = os.urandom(24)  # For session management

# Configuration — API key loaded from environment variable
API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not API_KEY:
    print("WARNING: GEMINI_API_KEY environment variable not set!")
    print("Set it with:  $env:GEMINI_API_KEY='your-key-here'  (PowerShell)")
    print("Then restart the server.")
genai.configure(api_key=API_KEY)
MODEL_NAME = "gemini-2.5-flash"

# Session context helper: Auto-expires after 1 hour (3600s), max 1000 concurrent
SESSION_CONTEXTS = TTLCache(maxsize=1000, ttl=3600)

# Authentication Session Storage (in-memory for MVP)
# Stores session ID -> Mock User Info
LOGGED_IN_USERS = TTLCache(maxsize=1000, ttl=86400) # 24 hour session length

def validate_session_id(session_id):
    """Validator to ensure strict session id formats and verify active login"""
    if not session_id or not isinstance(session_id, str):
        return False
    # Validate it's an alphanumeric string/uuid up to 40 chars
    if not bool(re.match(r'^[a-zA-Z0-9-]{10,40}$', session_id)):
        return False
        
    # Strictly enforce that they have logged in via the auth route
    if session_id not in LOGGED_IN_USERS:
        return False
        
    return True

@app.after_request
def apply_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    return response

# Ensure upload directory exists
UPLOAD_FOLDER = 'uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Web crawling settings
MAX_CRAWL_URLS = 3
CRAWL_TIMEOUT = 8  # seconds per URL
MAX_CONTENT_PER_PAGE = 3000  # characters per crawled page

try:
    model = genai.GenerativeModel(MODEL_NAME)
    print(f"Successfully initialized model {MODEL_NAME}")
except Exception as e:
    print(f"FALLBACK: Failed to initialize {MODEL_NAME}, using gemini-1.5-flash. Error: {e}")
    MODEL_NAME = "gemini-1.5-flash"
    model = genai.GenerativeModel(MODEL_NAME)


# ─── Web Crawling Helpers ───────────────────────────────────────────

def crawl_single_url(url):
    """Crawl a single URL and extract clean text content."""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        resp = requests.get(url, headers=headers, timeout=CRAWL_TIMEOUT)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, 'html.parser')

        # Remove unwanted elements
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe', 'noscript']):
            tag.decompose()

        # Extract title
        title = soup.title.string.strip() if soup.title and soup.title.string else urlparse(url).netloc

        # Extract main text content
        # Prefer article or main tags, fall back to body
        main_content = soup.find('article') or soup.find('main') or soup.find('body')
        if main_content:
            text = main_content.get_text(separator='\n', strip=True)
        else:
            text = soup.get_text(separator='\n', strip=True)

        # Clean up excessive whitespace
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = text[:MAX_CONTENT_PER_PAGE]

        return {
            'url': url,
            'title': title,
            'content': text,
            'domain': urlparse(url).netloc
        }
    except Exception as e:
        print(f"Error crawling {url}: {e}")
        return {
            'url': url,
            'title': urlparse(url).netloc,
            'content': '',
            'domain': urlparse(url).netloc
        }


def search_and_crawl(query):
    """Reliable search using Wikipedia API since search engines block the IP."""
    crawled_results = []
    
    try:
        import wikipedia
        # Get top 3 search results
        search_results = wikipedia.search(query, results=4)
    except Exception as e:
        print(f"Wikipedia search error: {e}")
        return []

    if not search_results:
        return []

    for title in search_results:
        try:
            # Fetch the actual page summary and url
            page = wikipedia.page(title, auto_suggest=False)
            crawled_results.append({
                'url': page.url,
                'title': page.title,
                'content': page.content[:3000],  # Give Gemini up to 3000 chars of context
                'domain': 'wikipedia.org',
                'body_snippet': page.summary[:160] + "..."  
            })
            if len(crawled_results) >= 3:
                break
        except wikipedia.exceptions.DisambiguationError as e:
            # If ambiguous, grab the first specific sub-option
            try:
                page = wikipedia.page(e.options[0], auto_suggest=False)
                crawled_results.append({
                    'url': page.url,
                    'title': page.title,
                    'content': page.content[:3000],
                    'domain': 'wikipedia.org',
                    'body_snippet': page.summary[:160] + "..."
                })
                if len(crawled_results) >= 3:
                    break
            except:
                continue
        except Exception as e:
            print(f"Error fetching page {title}: {e}")
            continue

    return crawled_results


# ─── Auth Routes ─────────────────────────────────────────────────────────

@app.route('/auth/dummy_login', methods=['POST'])
@limiter.limit("5 per minute")
def dummy_login():
    """Mock Google Login endpoint returning a secure authorized session."""
    import uuid
    # Usually we would extract a Google JWT token from request.json
    # and verify it here. For the dummy, we pretend it succeeded.
    
    new_session_id = str(uuid.uuid4())
    user_info = {
        "email": "tester@example.com",
        "name": "Test User",
        "picture": "https://lh3.googleusercontent.com/a/default-user=s96-c"
    }
    
    LOGGED_IN_USERS[new_session_id] = user_info
    
    return jsonify({
        "message": "Login successful",
        "session_id": new_session_id,
        "user": user_info
    })


# ─── App Routes ─────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
@limiter.limit("10 per minute")
def upload_file():
    session_id = request.headers.get("X-Session-ID")
    if not validate_session_id(session_id):
        return jsonify({"error": "Unauthorized. Please log in first."}), 401

    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    if file and file.filename.endswith('.pdf'):
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
        file.save(filepath)

        try:
            reader = PdfReader(filepath)
            extracted_text = ""
            for page in reader.pages:
                extracted_text += page.extract_text() + "\n"

            # Validate and store in session bounded memory cache
            session_id = request.headers.get("X-Session-ID", "default")
            if not validate_session_id(session_id):
                session_id = "default"
            SESSION_CONTEXTS[session_id] = extracted_text
            os.remove(filepath)

            # --- Financial Analysis MVP Trigger ---
            analysis_prompt = f"""You are Iridescent AI, a top-tier financial analyst.
Analyze the following document and output purely in JSON format.
The JSON must have the following keys exactly:
- "score": A number between 0 to 100 representing the financial health.
- "score_category": A short string e.g. "Strong", "Weak", "Average".
- "summary": A one-sentence summary of the company's financial status.
- "metrics": A list of objects, each containing:
   - "name": e.g. "Revenue Growth", "Gross Margin", "Debt / Equity", "Current Ratio", "Return on Equity"
   - "value": The extracted or estimated value e.g. "+8.2% YoY", "40%", "1.8x"
   - "comment": E.g. "Healthy — in line with sector average"
   - "status": E.g. "good", "warning", "danger" (for coloring)
- "strengths": A list of 2-3 positive points (strings).
- "risks": A list of 2-3 red flags or negative points (strings).

Do not wrap in markdown loops, output plain JSON:

DOCUMENT:
{extracted_text[:10000]} # Limiting context so it's fast
"""
            analysis_result = model.generate_content(analysis_prompt)
            raw_text = analysis_result.text.strip()
            # Clean possible markdown wrapping
            if raw_text.startswith("```json"):
                raw_text = raw_text.split("```json", 1)[1].rsplit("```", 1)[0].strip()
            elif raw_text.startswith("```"):
                raw_text = raw_text.split("```", 1)[1].rsplit("```", 1)[0].strip()

            print("Raw AI analysis:", raw_text)
            
            try:
                analysis_data = json.loads(raw_text)
            except json.JSONDecodeError:
                analysis_data = None # Gracefully fallback

            return jsonify({
                "message": "PDF uploaded and processed successfully",
                "char_count": len(extracted_text),
                "analysis": analysis_data
            })
        except Exception:
            return jsonify({"error": "Internal server error occurred during PDF parsing"}), 500

    return jsonify({"error": "Invalid file type. Please upload a PDF."}), 400


@app.route('/chat', methods=['POST'])
@limiter.limit("10 per minute")
def chat():
    data = request.json
    user_message = data.get('message', '')
    session_id = request.headers.get("X-Session-ID")
    
    if not validate_session_id(session_id):
        return jsonify({"error": "Unauthorized. Please log in first."}), 401
        
    user_context = SESSION_CONTEXTS.get(session_id, "")

    if not user_message or len(user_message) > 500:
        return jsonify({"error": "Invalid input: Message must be between 1 and 500 characters."}), 400

    # Simple RAG: Inject PDF context if available
    full_prompt = user_message
    if user_context:
        full_prompt = f"Context from uploaded Document:\n{user_context[:10000]}\n\nUser Question: {user_message}"

    try:
        response = model.generate_content(full_prompt)
        ai_response = response.text if response.parts else "[Response blocked or empty]"
        return jsonify({"response": ai_response})
    except Exception:
        return jsonify({"error": "Internal server error while generating response."}), 500


@app.route('/search', methods=['POST'])
@limiter.limit("10 per minute")
def web_search():
    """Search the web, crawl results, and generate an AI answer with sources."""
    session_id = request.headers.get("X-Session-ID")
    if not validate_session_id(session_id):
        return jsonify({"error": "Unauthorized. Please log in first."}), 401

    data = request.json
    user_message = data.get('message', '')

    if not user_message or len(user_message) > 500:
        return jsonify({"error": "Invalid input: Message must be between 1 and 500 characters."}), 400

    # Step 1: Search and crawl
    try:
        crawled_results = search_and_crawl(user_message)
    except Exception:
        crawled_results = []

    # Step 2: Build context from crawled content
    sources = []
    web_context_parts = []

    for i, result in enumerate(crawled_results):
        snippet = ""
        if result.get('body_snippet'):
            snippet = result['body_snippet']
        elif result.get('content'):
            # grab the first 160 chars of actual content as a snippet
            # removing simple newlines
            clean_content = result['content'].replace('\n', ' ')
            snippet = clean_content[:160] + "..." if len(clean_content) > 160 else clean_content
        else:
            snippet = "No description available for this page."

        sources.append({
            'url': result['url'],
            'title': result['title'],
            'domain': result['domain'],
            'snippet': snippet
        })
        web_context_parts.append(
            f"[Source {i+1}: {result['title']}]\nURL: {result['url']}\n{result['content']}"
        )

    web_context = "\n\n---\n\n".join(web_context_parts)

    # Step 3: Generate AI response with web context
    if web_context:
        prompt = f"""You are Iridescent AI, a helpful assistant that answers questions using information from the web.

Based on the following web sources, provide a comprehensive, well-structured answer to the user's question.
- Cite your sources directly in the text using Markdown links referencing the URLs provided (e.g., [[1]](URL), [[2]](URL)) naturally within your answer.
- If the sources don't contain enough information, supplement with your own knowledge but mention this.
- Format your response with clear paragraphs and use bullet points where appropriate.

Web Sources:
{web_context}

User Question: {user_message}

Provide a thorough, cited answer:"""
    else:
        prompt = f"""You are Iridescent AI. The user asked a question with web search enabled, but no web results could be retrieved.
Please answer the following question using your own knowledge, and mention that web search results were unavailable:

{user_message}"""

    try:
        response = model.generate_content(prompt)
        ai_response = response.text if response.parts else "[Response blocked or empty]"
        return jsonify({
            "response": ai_response,
            "sources": sources
        })
    except Exception:
        return jsonify({"error": "Internal server error during web search."}), 500


if __name__ == '__main__':
    print(f"Starting Iridescent AI server on port 8000 with model {MODEL_NAME}...")
    app.run(host='0.0.0.0', port=8000, debug=True)
