import React, { useState, useEffect } from 'react';
import { X, ChevronDown, Check } from 'lucide-react';
import { NodeData } from '../../types';

interface LibraryAsset {
    id: string;
    name: string;
    category: string;
    url: string;
    type: 'image' | 'video';
}

interface CreateAssetModalProps {
    isOpen: boolean;
    onClose: () => void;
    nodeToSnapshot: NodeData | null;
    onSave: (name: string, category: string) => Promise<void>;
    onAddToExisting: (assetId: string) => Promise<void>;
    fetchAssets: () => Promise<LibraryAsset[]>;
}

const CATEGORIES = [
    'Character',
    'Scene',
    'Item',
    'Style',
    'Sound Effect',
    'Others'
];

export const CreateAssetModal: React.FC<CreateAssetModalProps> = ({
    isOpen,
    onClose,
    nodeToSnapshot,
    onSave,
    onAddToExisting,
    fetchAssets
}) => {
    const [name, setName] = useState('My Assets');
    const [category, setCategory] = useState(CATEGORIES[0]);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
    const [activeTab, setActiveTab] = useState<'create' | 'existing'>('create');
    const [assets, setAssets] = useState<LibraryAsset[]>([]);
    const [selectedAssetId, setSelectedAssetId] = useState('');
    const [isLoadingAssets, setIsLoadingAssets] = useState(false);
    const [loadError, setLoadError] = useState('');

    useEffect(() => {
        if (isOpen) {
            setStatus('idle');
            setName('My Assets');
            setCategory(CATEGORIES[0]);
            setActiveTab('create');
            setSelectedAssetId('');
            setLoadError('');
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || activeTab !== 'existing') return;

        const loadAssets = async () => {
            setIsLoadingAssets(true);
            setLoadError('');
            try {
                const nextAssets = await fetchAssets();
                setAssets(nextAssets);
                setSelectedAssetId((current) => current || nextAssets[0]?.id || '');
            } catch (error) {
                setLoadError(error instanceof Error ? error.message : 'Failed to load assets');
            } finally {
                setIsLoadingAssets(false);
            }
        };

        loadAssets();
    }, [activeTab, fetchAssets, isOpen]);

    if (!isOpen || !nodeToSnapshot) return null;

    const handleSubmit = async () => {
        if (activeTab === 'create' && !name.trim()) return;
        if (activeTab === 'existing' && !selectedAssetId) return;

        setStatus('saving');
        try {
            if (activeTab === 'create') {
                await onSave(name, category);
            } else {
                await onAddToExisting(selectedAssetId);
            }
            setStatus('success');
            setTimeout(() => {
                onClose();
            }, 1000);
        } catch (e) {
            setStatus('error');
            setTimeout(() => setStatus('idle'), 2000);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#121212] border border-neutral-800 rounded-2xl w-[680px] shadow-2xl overflow-hidden flex flex-col">
                <div className="px-6 pt-6 pb-2">
                    <div className="flex items-center justify-between border-b border-neutral-700 pb-2">
                        <div className="flex items-center gap-6">
                            <button
                                onClick={() => setActiveTab('create')}
                                className={`font-medium pb-2 -mb-2.5 transition-colors ${activeTab === 'create' ? 'text-white border-b-2 border-white' : 'text-neutral-500 hover:text-neutral-300'}`}
                            >
                                Create Asset
                            </button>
                            <button
                                onClick={() => setActiveTab('existing')}
                                className={`font-medium pb-2 -mb-2.5 transition-colors ${activeTab === 'existing' ? 'text-white border-b-2 border-white' : 'text-neutral-500 hover:text-neutral-300'}`}
                            >
                                Add to Existing
                            </button>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1 text-neutral-500 hover:text-white transition-colors"
                            aria-label="Close create asset modal"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="p-6 flex gap-6">
                    <div className="w-1/2 flex flex-col gap-2">
                        <label className="text-sm font-medium text-neutral-200">Cover <span className="text-red-400">*</span></label>
                        <div className="aspect-[3/4] rounded-lg overflow-hidden border border-neutral-800 bg-neutral-900 relative group">
                            <img
                                src={nodeToSnapshot.resultUrl || ''}
                                alt="Cover"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).src = 'https://placehold.co/400x600/1a1a1a/FFF?text=Error';
                                }}
                            />
                        </div>
                    </div>

                    <div className="w-1/2 flex flex-col gap-6">
                        {activeTab === 'create' ? (
                            <>
                                <div className="flex flex-col gap-2">
                                    <label className="text-sm font-medium text-neutral-200">Name <span className="text-red-400">*</span></label>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        className="w-full bg-[#1a1a1a] border border-neutral-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                                        placeholder="Asset Name"
                                    />
                                </div>

                                <div className="flex flex-col gap-2 relative">
                                    <label className="text-sm font-medium text-neutral-200">Category <span className="text-red-400">*</span></label>
                                    <button
                                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                        className="w-full bg-[#1a1a1a] border border-neutral-700 rounded-lg px-3 py-2 text-white focus:outline-none flex items-center justify-between hover:bg-[#252525] transition-colors"
                                    >
                                        <span>{category}</span>
                                        <ChevronDown size={16} className="text-neutral-400" />
                                    </button>

                                    {isDropdownOpen && (
                                        <div className="absolute top-[70px] left-0 right-0 bg-[#1a1a1a] border border-neutral-700 rounded-lg shadow-xl z-10 py-1">
                                            {CATEGORIES.map(cat => (
                                                <button
                                                    key={cat}
                                                    onClick={() => {
                                                        setCategory(cat);
                                                        setIsDropdownOpen(false);
                                                    }}
                                                    className="w-full px-3 py-2 text-left hover:bg-[#252525] flex items-center justify-between group"
                                                >
                                                    <span className="text-neutral-300 group-hover:text-white">{cat}</span>
                                                    {category === cat && <Check size={14} className="text-white" />}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col gap-3">
                                <label className="text-sm font-medium text-neutral-200">Existing Asset <span className="text-red-400">*</span></label>
                                <p className="text-xs text-neutral-500">
                                    Select an existing asset to replace its current media with this node result.
                                </p>
                                {isLoadingAssets ? (
                                    <div className="text-sm text-neutral-400">Loading assets...</div>
                                ) : loadError ? (
                                    <div className="text-sm text-red-400">{loadError}</div>
                                ) : assets.length === 0 ? (
                                    <div className="text-sm text-neutral-500">No existing assets yet. Create one first.</div>
                                ) : (
                                    <div className="max-h-[280px] overflow-y-auto pr-1 flex flex-col gap-2">
                                        {assets.map(asset => (
                                            <button
                                                key={asset.id}
                                                onClick={() => setSelectedAssetId(asset.id)}
                                                className={`flex items-center gap-3 rounded-lg border p-2 text-left transition-colors ${selectedAssetId === asset.id ? 'border-[#2a9d8f] bg-[#2a9d8f]/10' : 'border-neutral-800 bg-[#1a1a1a] hover:border-neutral-600'}`}
                                            >
                                                <img
                                                    src={asset.url}
                                                    alt={asset.name}
                                                    className="w-12 h-12 rounded object-cover bg-neutral-900 shrink-0"
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).src = 'https://placehold.co/96x96/1a1a1a/FFF?text=Asset';
                                                    }}
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm text-white truncate">{asset.name}</div>
                                                    <div className="text-xs text-neutral-500">{asset.category} · {asset.type}</div>
                                                </div>
                                                {selectedAssetId === asset.id && <Check size={16} className="text-[#2a9d8f] shrink-0" />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-neutral-800 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-neutral-400 hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={status === 'saving' || status === 'success' || (activeTab === 'existing' && !selectedAssetId)}
                        className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-all duration-200 ${status === 'success' ? 'bg-green-600 text-white' :
                            status === 'error' ? 'bg-red-600 text-white' :
                                status === 'saving' ? 'bg-neutral-700 text-neutral-300' :
                                    'bg-[#2a9d8f] hover:bg-[#21867a] text-white disabled:bg-neutral-700 disabled:text-neutral-400 disabled:cursor-not-allowed'
                            }`}
                    >
                        {status === 'saving' && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        {status === 'success' && <Check size={16} />}
                        {status === 'idle' && (activeTab === 'create' ? 'Create' : 'Add')}
                        {status === 'saving' && 'Saving...'}
                        {status === 'success' && 'Saved!'}
                        {status === 'error' && 'Failed'}
                    </button>
                </div>
            </div>
        </div>
    );
};
