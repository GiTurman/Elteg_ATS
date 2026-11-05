// გამოძახების სტატუსის SMS კლიენტს (ფონურად — შეცდომა მუშაობას არ აჩერებს).
// ავტორი: Giorgi Turmanidze "GT"
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { notifyCallStatus } from "@/lib/sms.functions";

export function useNotifyStatus() {
  const fn = useServerFn(notifyCallStatus);
  return (callId: string) => {
    fn({ data: { callId } })
      .then((r) => {
        if (r && "ok" in r && r.ok) toast.success("კლიენტს SMS გაეგზავნა");
      })
      .catch(() => {
        /* SMS არასავალდებულოა */
      });
  };
}
