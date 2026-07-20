"""
Process legal PDF documents, generate embeddings, and store in Supabase
"""
import os
import sys
import time
import re
from pathlib import Path
from typing import List

from dotenv import load_dotenv
from tqdm import tqdm
from openai import OpenAI
from pypdf import PdfReader
from supabase import create_client
from langchain.text_splitter import RecursiveCharacterTextSplitter

# Load environment variables
load_dotenv()

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

# Configuration
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
EMBEDDING_MODEL = "openai/text-embedding-3-small"
EMBEDDING_DIM = 1536

_or_client = None

# Initialize Supabase client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Document categories mapping
DOCUMENT_CATEGORIES = {
    "Pakistan Panel code.pdf": "Criminal",
    "contract Act, 1872.pdf": "Civil",
    "Transfer of Property Act, 1882.pdf": "Civil",
    "THE MUSLIM FAMILY LAWS ORDINANCE, 1961.pdf": "Family",
    "THE PROTECTION AGAINST HARASSMENT OF WOMEN AT THE WORKPLACE ACT,2010.pdf": "Criminal"
}

DOCUMENT_TITLES = {
    "Pakistan Panel code.pdf": "Pakistan Penal Code, 1860",
    "contract Act, 1872.pdf": "Contract Act, 1872",
    "Transfer of Property Act, 1882.pdf": "Transfer of Property Act, 1882",
    "THE MUSLIM FAMILY LAWS ORDINANCE, 1961.pdf": "Muslim Family Laws Ordinance, 1961",
    "THE PROTECTION AGAINST HARASSMENT OF WOMEN AT THE WORKPLACE ACT,2010.pdf": "Protection Against Harassment of Women at the Workplace Act, 2010"
}

def extract_text_from_pdf(pdf_path):
    """Extract text from PDF file"""
    print(f"📄 Reading: {pdf_path.name}")
    reader = PdfReader(pdf_path)
    text = ""
    for page in reader.pages:
        text += page.extract_text() + "\n"
    return text

def clean_text(text: str) -> str:
    """Normalize legal text before chunking."""
    text = re.sub(r'\bdafa\s+(\d+)', r'Section \1', text, flags=re.IGNORECASE)
    text = re.sub(r'§\s*(\d+)', r'Section \1', text)
    text = re.sub(r'Page \d+\s*of\s*\d+', '', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip()

def chunk_text(text, chunk_size=1000, chunk_overlap=200):
    """Split text into chunks for embedding"""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
    )
    return splitter.split_text(text)

def get_openrouter_client() -> OpenAI:
    """Lazy-load OpenRouter client."""
    global _or_client
    if _or_client is None:
        if not OPENROUTER_API_KEY:
            raise RuntimeError("OPENROUTER_API_KEY not set in environment")
        _or_client = OpenAI(
            api_key=OPENROUTER_API_KEY,
            base_url="https://openrouter.ai/api/v1"
        )
    return _or_client

def generate_embeddings_batch(texts: List[str], batch_size: int = 100) -> List[List[float]]:
    """
    Generate embeddings for many texts efficiently using OpenRouter's OpenAI-compatible API.
    """
    client = get_openrouter_client()
    all_embeddings = []

    for i in range(0, len(texts), batch_size):
        batch = [t.replace("\n", " ").strip() for t in texts[i:i + batch_size]]
        for attempt in range(3):
            try:
                response = client.embeddings.create(
                    model=EMBEDDING_MODEL,
                    input=batch
                )
                all_embeddings.extend([d.embedding for d in response.data])
                break
            except Exception as e:
                if attempt == 2:
                    raise
                wait = 2 ** attempt
                print(f"   Batch failed (attempt {attempt+1}/3): {e}. Retrying in {wait}s...")
                time.sleep(wait)

    return all_embeddings

def process_document(pdf_path, category):
    """Process a single PDF document"""
    print(f"\n{'='*60}")
    print(f"Processing: {pdf_path.name}")
    print(f"Category: {category}")
    print(f"{'='*60}")
    
    # Extract text
    text = clean_text(extract_text_from_pdf(pdf_path))
    print(f"✓ Extracted {len(text)} characters")
    
    # Chunk text
    chunks = chunk_text(text)
    print(f"✓ Created {len(chunks)} chunks")
    
    # Generate embeddings in batches for better performance
    print(f"🔄 Generating embeddings and storing...")
    embeddings = generate_embeddings_batch(chunks)

    title = DOCUMENT_TITLES.get(pdf_path.name, pdf_path.stem)

    rows = [
        {
            "title": title,
            "category": category,
            "source_file": pdf_path.name,
            "content": chunk,
            "embedding": embedding,
            "metadata": {
                "chunk_index": i,
                "total_chunks": len(chunks)
            }
        }
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings))
    ]

    # Insert in batches for reliability and speed
    for i in tqdm(range(0, len(rows), 200), desc="Inserting"):
        batch = rows[i:i + 200]
        try:
            supabase.table("legal_documents").insert(batch).execute()
        except Exception as e:
            print(f"\n❌ Error inserting batch starting at {i}: {str(e)}")
            continue
    
    print(f"✅ Completed: {pdf_path.name}\n")

def main():
    """Main processing function"""
    print("\n" + "="*60)
    print("AI JUSTICE ASSISTANT - DOCUMENT PROCESSOR")
    print("="*60 + "\n")
    
    # Verify environment variables
    if not all([SUPABASE_URL, SUPABASE_KEY, OPENROUTER_API_KEY]):
        print("❌ Error: Missing environment variables!")
        print("Please check your .env file contains:")
        print("  - VITE_SUPABASE_URL")
        print("  - SUPABASE_SERVICE_ROLE_KEY")
        print("  - OPENROUTER_API_KEY")
        sys.exit(1)
    
    # Get data directory relative to the project root
    data_dir = PROJECT_ROOT / "data"
    if not data_dir.exists():
        print(f"❌ Error: Data directory not found: {data_dir}")
        sys.exit(1)
    
    # Get all PDF files
    pdf_files = list(data_dir.glob("*.pdf"))
    if not pdf_files:
        print(f"❌ Error: No PDF files found in {data_dir}")
        sys.exit(1)
    
    print(f"Found {len(pdf_files)} PDF files to process\n")
    
    # Process each PDF
    for pdf_path in pdf_files:
        category = DOCUMENT_CATEGORIES.get(pdf_path.name, "Civil")
        try:
            process_document(pdf_path, category)
        except Exception as e:
            print(f"❌ Failed to process {pdf_path.name}: {str(e)}")
            continue
    
    print("\n" + "="*60)
    print("✅ PROCESSING COMPLETE!")
    print("="*60)
    print("\nNext steps:")
    print("1. Run: python scripts/load_courts.py")
    print("2. Run: python scripts/load_lawyers.py")
    print("3. Deploy Edge Functions")

if __name__ == "__main__":
    main()
