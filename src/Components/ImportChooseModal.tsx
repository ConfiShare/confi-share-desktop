import { useRef } from "react";
import { Upload } from "lucide-react";
import { Modal } from "./Modal";
import { useApp } from "../store/AppContext";

export function ImportChooseModal() {
  const { closeModal, openModal } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleChooseFile() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      openModal({ type: "import_confirm", pendingFile: file });
    }
    // Reset so same file can be re-selected
    e.target.value = "";
  }

  return (
    <Modal onClose={closeModal}>
      <div className="flex flex-col items-center px-8 py-10">
        {/* Upload icon circle */}
        <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-5">
          <Upload className="w-6 h-6 text-gray-700" />
        </div>

        <h2 className="text-[1.125rem] font-semibold text-gray-900 mb-7">
          Import a secure document
        </h2>

        <button
          onClick={handleChooseFile}
          className="w-full py-3.5 size-14 cursor-pointer bg-[#059669] hover:bg-green-700 active:bg-green-800 text-white font-semibold text-sm rounded-xl transition-colors"
        >
          Choose file
        </button>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".cdc,.pdf,.doc,.docx"
          onChange={handleFileChange}
        />
      </div>
    </Modal>
  );
}
