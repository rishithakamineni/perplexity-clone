import os
import flask
from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_cors import CORS
import google.generativeai as genai
from PyPDF2 import PdfReader

app = Flask(__name__)
CORS(app)

# Configuration
API_KEY = "AIzaSyD_nvkzUA7XRUFue-1UP-iiwl95ndmZH1Q"
genai.configure(api_key=API_KEY)
MODEL_NAME = "gemini-2.5-flash"

# Persistence for PDF context (simple global for this version)
PDF_TEXT_CONTEXT = ""

# Ensure upload directory exists
UPLOAD_FOLDER = 'uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

try:
    model = genai.GenerativeModel(MODEL_NAME)
    print(f"Successfully initialized model {MODEL_NAME}")
except Exception as e:
    print(f"FALLBACK: Failed to initialize {MODEL_NAME}, using gemini-1.5-flash. Error: {e}")
    MODEL_NAME = "gemini-1.5-flash"
    model = genai.GenerativeModel(MODEL_NAME)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    global PDF_TEXT_CONTEXT
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    if file and file.filename.endswith('.pdf'):
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
        file.save(filepath)
        
        try:
            # Extract text using PyPDF2
            reader = PdfReader(filepath)
            extracted_text = ""
            for page in reader.pages:
                extracted_text += page.extract_text() + "\n"
            
            PDF_TEXT_CONTEXT = extracted_text
            # Cleanup
            os.remove(filepath)
            
            return jsonify({
                "message": "PDF uploaded and processed successfully",
                "char_count": len(extracted_text)
            })
        except Exception as e:
            return jsonify({"error": f"Error parsing PDF: {str(e)}"}), 500
            
    return jsonify({"error": "Invalid file type. Please upload a PDF."}), 400

@app.route('/chat', methods=['POST'])
def chat():
    global PDF_TEXT_CONTEXT
    data = request.json
    user_message = data.get('message', '')
    
    if not user_message:
        return jsonify({"error": "No message provided"}), 400
    
    # Simple RAG: Inject PDF context if available
    full_prompt = user_message
    if PDF_TEXT_CONTEXT:
        full_prompt = f"Context from uploaded PDF:\n{PDF_TEXT_CONTEXT}\n\nUser Question: {user_message}"
    
    try:
        response = model.generate_content(full_prompt)
        ai_response = response.text if response.parts else "[Response blocked or empty]"
        return jsonify({"response": ai_response})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Standard static files are served from /static folder by default in Flask.
# No need for a custom static route if we use url_for in the template or /static/ path.

if __name__ == '__main__':
    print(f"Starting Iridescent AI server on port 8000 with model {MODEL_NAME}...")
    # Using host='0.0.0.0' exposes the app to your local network instead of just localhost
    app.run(host='0.0.0.0', port=8000, debug=True)
