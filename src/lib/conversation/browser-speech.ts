export function speakBrowserText(text: string): boolean {
  const spokenText = text.trim();
  if (!spokenText) return false;
  if (typeof window === 'undefined') return false;
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return false;

  const utterance = new SpeechSynthesisUtterance(spokenText);
  utterance.lang = 'pt-BR';
  utterance.volume = 1;
  utterance.rate = 0.95;
  utterance.pitch = 1;

  const voices = window.speechSynthesis.getVoices();
  const preferredVoice =
    voices.find((voice) => voice.lang.toLowerCase() === 'pt-br') ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith('pt'));
  if (preferredVoice) utterance.voice = preferredVoice;

  window.speechSynthesis.cancel();
  window.speechSynthesis.resume();
  window.speechSynthesis.speak(utterance);
  return true;
}
