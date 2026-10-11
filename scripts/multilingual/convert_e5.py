#!/usr/bin/env python3
# MIT License
# Copyright (c) 2026 NIDO contributors
# See LICENSE file for details.
"""
Runs llama.cpp's convert_hf_to_gguf.py for multilingual-e5-small.

Why a wrapper: multilingual-e5-small is a BERT model ("architectures":
["BertModel"], absolute positions from 0) that uses the XLM-RoBERTa
SentencePiece tokenizer. The stock converter picks BertModel and then tries
to read a WordPiece/BPE vocabulary, which fails ("BPE pre-tokenizer was not
recognized"). Converting it as XLMRobertaModel instead would read the right
tokenizer but would also drop the first (pad_token_id + 1) position
embeddings, which is only correct for RoBERTa-style positions - wrong here.

So: keep BertModel for the weights and use the converter's own XLM-R
SentencePiece vocabulary writer (BertModel._xlmroberta_set_vocab, the one
bge-m3 uses) for the tokenizer. Nothing else changes. Correctness is checked
afterwards by the parity step (token ids and embeddings vs the original
model), not assumed.

Usage: convert_e5.py <llama.cpp dir> <convert_hf_to_gguf.py args...>
"""

import runpy
import sys
from pathlib import Path

llama_dir = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(llama_dir / "gguf-py"))
sys.path.insert(0, str(llama_dir))

from conversion import bert  # noqa: E402  (llama.cpp's package)

_original_set_vocab = bert.BertModel.set_vocab


def _set_vocab(self):
    if type(self) is bert.BertModel and (self.dir_model / "sentencepiece.bpe.model").is_file():
        print("convert_e5: BertModel with XLM-R SentencePiece tokenizer -> t5/UGM vocab", flush=True)
        return self._xlmroberta_set_vocab()
    return _original_set_vocab(self)


bert.BertModel.set_vocab = _set_vocab

sys.argv = [str(llama_dir / "convert_hf_to_gguf.py")] + sys.argv[2:]
runpy.run_path(sys.argv[0], run_name="__main__")
