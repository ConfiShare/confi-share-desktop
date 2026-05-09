import { CheckCircle } from "lucide-react";
import { Modal } from "./Modal";
import { useApp } from "../store/AppContext";

export function ImportSuccessModal() {
  const { closeModal } = useApp();

  return (
    <Modal onClose={closeModal} showClose={true}>
      <div className="flex flex-col items-center px-8 py-10">
        {/* Success icon */}
        <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mb-5">
          <CheckCircle className="w-7 h-7 text-[#059669]" strokeWidth={2} />
        </div>

        <h2 className="text-[1.125rem] font-semibold text-gray-900 mb-6">
          Document imported successfully
        </h2>

        <button
          onClick={closeModal}
          className="w-full py-3.5 size-14 cursor-pointer bg-[#059669] hover:bg-green-700 active:bg-green-800 text-white font-semibold text-sm rounded-xl transition-colors"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
