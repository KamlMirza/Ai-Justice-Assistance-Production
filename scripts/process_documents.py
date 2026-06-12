"""
Process legal PDF documents, generate embeddings, and store in Supabase
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from tqdm import tqdm
import requests
from pypdf import PdfReader
from supabase import create_client
from langchain.text_splitter import RecursiveCharacterTextSplitter

# Load environment variables
load_dotenv()

# Configuration
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

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

def extract_text_from_pdf(pdf_path):
    """Extract text from PDF file"""
    print(f"📄 Reading: {pdf_path.name}")
    reader = PdfReader(pdf_path)
    text = ""
    for page in reader.pages:
        text += page.extract_text() + "\n"
    return text

def chunk_text(text, chunk_size=1000, chunk_overlap=200):
    """Split text into chunks for embedding"""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
    )
    return splitter.split_text(text)

def generate_embedding(text):
    """Generate embedding using sentence-transformers (local, free, high-quality)"""
    from sentence_transformers import SentenceTransformer
    
    # Use a high-quality embedding model (runs locally, no API needed)
    # This model generates 768-dimensional embeddings
    global embedding_model
    if 'embedding_model' not in globals():
        print("Loading embedding model (first time only)...")
        embedding_model = SentenceTransformer('sentence-transformers/all-mpnet-base-v2')
    
    # Generate embedding
    embedding = embedding_model.encode(text, convert_to_numpy=True)
    return embedding.tolist()

def process_document(pdf_path, category):
    """Process a single PDF document"""
    print(f"\n{'='*60}")
    print(f"Processing: {pdf_path.name}")
    print(f"Category: {category}")
    print(f"{'='*60}")
    
    # Extract text
    text = extract_text_from_pdf(pdf_path)
    print(f"✓ Extracted {len(text)} characters")
    
    # Chunk text
    chunks = chunk_text(text)
    print(f"✓ Created {len(chunks)} chunks")
    
    # Process each chunk
    print(f"🔄 Generating embeddings and storing...")
    for i, chunk in enumerate(tqdm(chunks, desc="Processing chunks")):
        try:
            # Generate embedding
            embedding = generate_embedding(chunk)
            
            # Store in database
            data = {
                "title": pdf_path.stem,
                "category": category,
                "source_file": pdf_path.name,
                "content": chunk,
                "embedding": embedding,
                "metadata": {
                    "chunk_index": i,
                    "total_chunks": len(chunks)
                }
            }
            
            supabase.table("legal_documents").insert(data).execute()
            
        except Exception as e:
            print(f"\n❌ Error processing chunk {i}: {str(e)}")
            continue
    
    print(f"✅ Completed: {pdf_path.name}\n")

def main():
    """Main processing function"""
    print("\n" + "="*60)
    print("AI JUSTICE ASSISTANT - DOCUMENT PROCESSOR")
    print("="*60 + "\n")
    
    # Verify environment variables
    if not all([SUPABASE_URL, SUPABASE_KEY]):
        print("❌ Error: Missing environment variables!")
        print("Please check your .env file contains:")
        print("  - VITE_SUPABASE_URL")
        print("  - SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)
    
    # Get data directory
    data_dir = Path("data")
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
