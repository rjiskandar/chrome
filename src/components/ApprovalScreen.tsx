import { useState, useEffect } from 'react';
import './ApprovalScreen.css';

interface PendingRequest {
    id: string;
    origin: string;
    chainId: string;
    timestamp: number;
}

interface ApprovalScreenProps {
    onClose: () => void;
}

export function ApprovalScreen({ onClose }: ApprovalScreenProps) {
    const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Safety check
        if (!chrome?.runtime?.sendMessage) {
            console.log("[Approval] Chrome runtime not available");
            setLoading(false);
            return;
        }

        try {
            // Get pending requests from background
            chrome.runtime.sendMessage(
                { type: "GET_PENDING_REQUESTS" },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.log("[Approval] Error:", chrome.runtime.lastError);
                        setLoading(false);
                        return;
                    }
                    console.log("[Approval] Pending requests:", response);
                    if (response?.requests?.length > 0) {
                        setPendingRequest(response.requests[0]);
                    }
                    setLoading(false);
                }
            );
        } catch (error) {
            console.log("[Approval] Exception:", error);
            setLoading(false);
        }
    }, []);

    const handleApprove = () => {
        if (!pendingRequest || !chrome?.runtime?.sendMessage) return;

        try {
            console.log("[Approval] Approving connection:", pendingRequest.id);
            chrome.runtime.sendMessage({
                type: "APPROVE_CONNECTION",
                requestId: pendingRequest.id
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("[Approval] Error:", chrome.runtime.lastError);
                    return;
                }
                console.log("[Approval] Approval response:", response);
                onClose();
            });
        } catch (error) {
            console.error("[Approval] Exception:", error);
        }
    };

    const handleReject = () => {
        if (!pendingRequest || !chrome?.runtime?.sendMessage) return;

        try {
            console.log("[Approval] Rejecting connection:", pendingRequest.id);
            chrome.runtime.sendMessage({
                type: "REJECT_CONNECTION",
                requestId: pendingRequest.id
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("[Approval] Error:", chrome.runtime.lastError);
                    return;
                }
                console.log("[Approval] Rejection response:", response);
                onClose();
            });
        } catch (error) {
            console.error("[Approval] Exception:", error);
        }
    };

    if (loading) {
        return (
            <div className="approval-screen">
                <div className="loading">Loading...</div>
            </div>
        );
    }

    if (!pendingRequest) {
        return (
            <div className="approval-screen">
                <div className="no-requests">No pending requests</div>
            </div>
        );
    }

    return (
        <div className="approval-screen">
            <div className="approval-header">
                <h2>🔗 Connection Request</h2>
            </div>

            <div className="dapp-info">
                <div className="info-row">
                    <span className="label">Origin:</span>
                    <span className="value">{pendingRequest.origin}</span>
                </div>
                <div className="info-row">
                    <span className="label">Chain:</span>
                    <span className="value">{pendingRequest.chainId}</span>
                </div>
            </div>

            <div className="warning">
                <p>⚠️ Only connect to websites you trust</p>
                <p className="warning-detail">
                    This site is requesting to connect to your wallet.
                    It will be able to see your account address.
                </p>
            </div>

            <div className="buttons">
                <button onClick={handleReject} className="reject-btn">
                    ❌ Reject
                </button>
                <button onClick={handleApprove} className="approve-btn">
                    ✅ Approve
                </button>
            </div>
        </div>
    );
}
