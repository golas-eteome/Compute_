import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ComputeTask {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<ComputeTask[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newTaskData, setNewTaskData] = useState({ name: "", computeValue: "", description: "" });
  const [selectedTask, setSelectedTask] = useState<ComputeTask | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState({ total: 0, verified: 0, active: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const tasksList: ComputeTask[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          tasksList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setTasks(tasksList);
      updateStats(tasksList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (tasksList: ComputeTask[]) => {
    setStats({
      total: tasksList.length,
      verified: tasksList.filter(t => t.isVerified).length,
      active: tasksList.filter(t => Date.now()/1000 - t.timestamp < 86400).length
    });
  };

  const createTask = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingTask(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating compute task with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const computeValue = parseInt(newTaskData.computeValue) || 0;
      const businessId = `task-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, computeValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTaskData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newTaskData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Compute task created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTaskData({ name: "", computeValue: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingTask(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredTasks = tasks.filter(task => 
    task.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    task.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Compute Market 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet</h2>
            <p>Connect your wallet to access the encrypted compute marketplace</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading compute tasks...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Compute Market 🔐</h1>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check Availability
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Compute Task
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panels">
          <div className="stat-panel">
            <h3>Total Tasks</h3>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-panel">
            <h3>Verified</h3>
            <div className="stat-value">{stats.verified}</div>
          </div>
          <div className="stat-panel">
            <h3>Active</h3>
            <div className="stat-value">{stats.active}</div>
          </div>
        </div>

        <div className="search-section">
          <input 
            type="text"
            placeholder="Search tasks..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="tasks-grid">
          {filteredTasks.length === 0 ? (
            <div className="no-tasks">
              <p>No compute tasks found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Task
              </button>
            </div>
          ) : (
            filteredTasks.map((task, index) => (
              <div 
                className={`task-card ${task.isVerified ? "verified" : ""}`}
                key={index}
                onClick={() => setSelectedTask(task)}
              >
                <div className="task-header">
                  <h3>{task.name}</h3>
                  <span className={`status ${task.isVerified ? "verified" : "pending"}`}>
                    {task.isVerified ? "✅ Verified" : "🔓 Pending"}
                  </span>
                </div>
                <p className="task-desc">{task.description}</p>
                <div className="task-meta">
                  <span>Creator: {task.creator.substring(0, 6)}...{task.creator.substring(38)}</span>
                  <span>Created: {new Date(task.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                {task.isVerified && (
                  <div className="decrypted-value">
                    Result: {task.decryptedValue}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateTask 
          onSubmit={createTask} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingTask} 
          taskData={newTaskData} 
          setTaskData={setNewTaskData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedTask && (
        <TaskDetailModal 
          task={selectedTask} 
          onClose={() => { 
            setSelectedTask(null); 
            setDecryptedData(null); 
          }} 
          decryptedData={decryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedTask.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p>FHE-based Cloud Computing Market - Powered by Zama</p>
          <div className="footer-links">
            <span>Privacy-Preserving Computation</span>
            <span>Data Never Decrypted</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

const ModalCreateTask: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  taskData: any;
  setTaskData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, taskData, setTaskData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'computeValue') {
      const intValue = value.replace(/[^\d]/g, '');
      setTaskData({ ...taskData, [name]: intValue });
    } else {
      setTaskData({ ...taskData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-task-modal">
        <div className="modal-header">
          <h2>New Compute Task</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Compute value will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Task Name *</label>
            <input 
              type="text" 
              name="name" 
              value={taskData.name} 
              onChange={handleChange} 
              placeholder="Enter task name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Compute Value (Integer only) *</label>
            <input 
              type="number" 
              name="computeValue" 
              value={taskData.computeValue} 
              onChange={handleChange} 
              placeholder="Enter compute value..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={taskData.description} 
              onChange={handleChange} 
              placeholder="Enter task description..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !taskData.name || !taskData.computeValue || !taskData.description} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Task"}
          </button>
        </div>
      </div>
    </div>
  );
};

const TaskDetailModal: React.FC<{
  task: ComputeTask;
  onClose: () => void;
  decryptedData: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ task, onClose, decryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) return;
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="task-detail-modal">
        <div className="modal-header">
          <h2>Compute Task Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="task-info">
            <div className="info-item">
              <span>Task Name:</span>
              <strong>{task.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{task.creator.substring(0, 6)}...{task.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(task.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{task.description}</p>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Compute Data</h3>
            
            <div className="data-row">
              <div className="data-label">Compute Value:</div>
              <div className="data-value">
                {task.isVerified ? 
                  `${task.decryptedValue} (On-chain Verified)` : 
                  decryptedData !== null ? 
                  `${decryptedData} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${(task.isVerified || decryptedData !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || task.isVerified}
              >
                {isDecrypting ? "🔓 Verifying..." : task.isVerified ? "✅ Verified" : "🔓 Verify Decryption"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Privacy Protection</strong>
                <p>Data remains encrypted during computation. Only authorized parties can decrypt results.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

